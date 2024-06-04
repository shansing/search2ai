const fetch = require('node-fetch');
const search = require('../units/search.js');
const crawler = require('../units/crawler.js');
const news = require('../units/news.js');
const lucky = require('../units/lucky.js');
const Common = require('./common.js');
const { config } = require('dotenv');
const Stream = require('stream');

config();

const corsHeaders = {
    // 'Access-Control-Allow-Origin': '*',
    // 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', // 允许的HTTP方法
    // 'Access-Control-Allow-Headers': 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,Authorization',
    // 'Access-Control-Max-Age': '86400', // 预检请求结果的缓存时间
};
async function handleRequest(req, res) {
    if (req.method !== 'POST') {
        throw Error('[openai]Method Not Allowed');
    }
    const requestData = req.body;
    // console.log('[openai]requestData: ', requestData);
    let baseUrl = req.headers["x-shansing-base-url"];
    console.log('[openai]baseUrl: ', baseUrl);
    if (!baseUrl) {
        // throw Error('[openai]no baseUrl provided');
        baseUrl = 'https://api.openai.com'
        console.log('[openai]using default baseUrl');
    }
    const requestHeader = {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Authorization": req.headers["authorization"],
    }

    const maxTokens = requestData.max_tokens || 2000;

    const messages = requestData.messages;
    const userMessages = requestData.messages.filter(message => message.role === 'user');
    const latestUserMessage = userMessages[userMessages.length - 1];
    const latestUserMessageContent = latestUserMessage.content;

    let requestBody = JSON.parse(JSON.stringify(requestData));
    requestBody.stream = false;
    requestBody.stream_options = undefined;
    requestBody.max_tokens = maxTokens;
    // if (!Array.isArray(latestUserMessageContent)
    //     || latestUserMessageContent.some(content => content?.type === 'text')) {
    requestBody = {
        ...requestBody,
        tools: tools,
        //qwen doesn't support it; has a default value
        // tool_choice: "auto",
    }

    let openAIResponse;
    try {
        console.log('[openai]sending the first request');
        openAIResponse = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: requestHeader,
            body: JSON.stringify(requestBody)
        });
    } catch (error) {
        throw Error('[openai]API failed: ' + error.message);
    }
    if (!openAIResponse.ok) {
        // console.log('[openai]API not ok, body:', await openAIResponse.text());
        throw Error('[openai]API not ok, status:' + GeminiResponse.status + ', body:' + await openAIResponse.text());
    }

    let responseJson = await openAIResponse.json();
    // console.log('[openai]确认解析后的 data 对象:', data);
    if (!responseJson) {
        throw Error('[openai]no response');
    }
    console.log('[openai]API response got，check if need function call...');
    if (!responseJson.choices || responseJson.choices.length === 0 || !responseJson.choices[0].message) {
        throw Error('[openai]response has no choice');
    }
    if (!responseJson.usage) {
        throw Error('[openai]response has no usage');
    }

    let firstMaxPromptTokenNumber = responseJson.usage.prompt_tokens,
    firstCompletionTokenNumber = responseJson.usage.completion_tokens,
    searchCount = 0,
    newsCount = 0,
    crawlerCount = 0;

    messages.push(responseJson.choices[0].message);
    // console.log('[openai]更新后的 messages 数组:', messages);
    // 检查是否有函数调用
    // console.log('[openai]开始检查是否有函数调用');


    const availableFunctions = {
        "searchWeb": search,
        "searchNews": news,
        "readWebPage": crawler,
        "searchAndReadFirstResult": lucky
    };
    let calledCustomFunction = false;
    if (responseJson.choices[0].message.tool_calls) {
        const toolCalls = responseJson.choices[0].message.tool_calls;
        const unprocessedMessages = JSON.parse(JSON.stringify(messages));
        for (const toolCall of toolCalls) {
            if (!toolCall.id) {
                // qwen-max bug on 2024/6/4
                throw Error('API function call temporarily unavailable')
            }
            const functionName = toolCall.function.name;
            const functionToCall = availableFunctions[functionName];
            const functionArgs = JSON.parse(toolCall.function.arguments);
            let functionResponse;
            if (functionName === 'searchWeb') {
                functionResponse = await functionToCall(functionArgs.query);
                searchCount++;
            } else if (functionName === 'readWebPage') {
                functionResponse = await functionToCall(functionArgs.url);
                crawlerCount++;
            } else if (functionName === 'searchNews') {
                functionResponse = await functionToCall(functionArgs.query);
                newsCount++;
            } else if (functionName === 'searchAndReadFirstResult') {
                functionResponse = await functionToCall(functionArgs.query);
                searchCount++;
                crawlerCount++;
            }
            functionResponse = JSON.stringify(Common.cut(functionResponse, requestBody.model, unprocessedMessages, maxTokens, toolCalls.length))
            if (functionResponse != null) {
                messages.push({
                    tool_call_id: toolCall.id,
                    role: "tool",
                    name: functionName,
                    content: functionResponse,
                });
                calledCustomFunction = true;
            }
        }
    }
    // console.log('[openai]function call checked');

    if (!calledCustomFunction) {
        // 没有调用自定义函数，直接返回原始回复（转换为SSE）
        console.log('[openai]no function call needed, sending response as SSE format');
        //强制流式
        const sseStream = jsonToStream(responseJson);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...corsHeaders, });
        sseStream.on('data', (chunk) => {
            res.write(chunk);
        });
        sseStream.on('end', () => {
            res.end();
        });
        // return ;
    } else {
        // 如果调用了自定义函数，再次向 API 发送请求
        console.log('[openai]function call needed, sending request again');
        const secondRequestBody = {
            ...requestBody,
            stream: true,
            stream_options: {
                include_usage: true,
            },
            tools: undefined,
            tool_choice: undefined,
            messages: messages,
        };
        try {
            let secondResponse = await fetch(`${baseUrl}/v1/chat/completions`, {
                method: 'POST',
                headers: requestHeader,
                body: JSON.stringify(secondRequestBody)
            });
            //强制流式
            console.log('[openai]sending second response...');
            // console.log('[gemini]secondRequestBody', JSON.stringify(secondRequestBody));

            return {
                status: secondResponse.status,
                headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',...corsHeaders,
                    'X-Shansing-First-Prompt-Token-Number': firstMaxPromptTokenNumber,
                    'X-Shansing-First-Completion-Token-Number': firstCompletionTokenNumber,
                    'X-Shansing-Search-Count': searchCount,
                    'X-Shansing-News-Count': newsCount,
                    'X-Shansing-Crawler-Count': crawlerCount,
                },
                body: secondResponse.body
            };
        } catch (error) {
            throw Error('[openai]API second failed:' + error.message);
        }
    }

}

function jsonToStream(jsonData) {
    return new Stream.Readable({
        read() {
            const pushData = () => {
                const contentData = {
                    id: jsonData.id,
                    object: 'chat.completion.chunk',
                    created: jsonData.created,
                    model: jsonData.model,
                    choices: [
                        {
                            index: 0,
                            delta: {
                                content: jsonData.choices[0].message.content
                            },
                            logprobs: null,
                            finish_reason: null
                        }
                    ],
                    system_fingerprint: jsonData.system_fingerprint,
                    usage: null,
                }
                this.push(`data: ${JSON.stringify(contentData)}\n\n`, 'utf8');
                const stopData = {
                    id: jsonData.id,
                    object: 'chat.completion.chunk',
                    created: jsonData.created,
                    model: jsonData.model,
                    choices: [
                        {
                            index: 0,
                            delta: {},
                            logprobs: null,
                            finish_reason: 'stop'
                        }
                    ],
                    system_fingerprint: jsonData.system_fingerprint,
                    usage: null,
                }
                this.push(`data: ${JSON.stringify(stopData)}\n\n`, 'utf8');
                const usageData = {
                    id: jsonData.id,
                    object: 'chat.completion.chunk',
                    created: jsonData.created,
                    model: jsonData.model,
                    choices: [],
                    system_fingerprint: jsonData.system_fingerprint,
                    usage: jsonData.usage,
                }
                this.push(`data: ${JSON.stringify(usageData)}\n\n`, 'utf8');
                this.push('data: [DONE]\n\n', 'utf8');
                this.push(null);  // 结束流
            };

            setTimeout(pushData, 0);
        }
    });
}

const tools = [
    {
        type: "function",
        function: {
            name: "searchWeb",
            description: "Perform a web search using specific keywords. (like Google search)",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string","description": "Keywords for the web search."}
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "searchNews",
            description: "Search for news articles using specific keywords. (like Google News)",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Keywords for the news search."}
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "readWebPage",
            description: "Fetch and parse the content of the given URL's webpage. (like Reader View of Firefox)",
            parameters: {
                type: "object",
                properties: {
                    url: {
                        type: "string",
                        description: "The URL of the webpage."},
                },
                required: ["url"],
            }
        }
    },
    {
        type: "function",
        function: {
            name: "searchAndReadFirstResult",
            description: "Perform a web search and read the content of the first search result. (like I'm Feeling Lucky of Google)",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string","description": "Keywords for the web search."}
                },
                required: ["query"]
            }
        }
    },
]

module.exports = handleRequest;

