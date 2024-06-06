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
        throw Error('[anthropic]Method Not Allowed');
    }
    const requestData = req.body;
    // console.log('[anthropic]requestData: ', requestData);
    const baseUrl = req.headers["x-shansing-base-url"];
    console.log('[anthropic]baseUrl: ', baseUrl);
    if (!baseUrl) {
        throw Error('[anthropic]no baseUrl provided');
    }
    const requestHeader = {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "x-api-key": req.headers["x-api-key"],
        "anthropic-version": req.headers["anthropic-version"] || '2023-06-01',
    }

    const maxTokens = requestData?.max_tokens || 2000;

    const messages = requestData.messages;
    // const userMessages = requestData.messages.filter(message => message.role === 'user');
    // const latestUserMessage = userMessages[userMessages.length - 1];
    // const latestUserMessageContent = latestUserMessage.content;

    let requestBody = JSON.parse(JSON.stringify(requestData));
    requestBody.stream = false;
    requestBody.max_tokens = maxTokens;
    // if (!Array.isArray(latestUserMessageContent)
    //     || latestUserMessageContent.some(content => content?.type === 'text')) {
    requestBody = {
        ...requestBody,
        tools: tools,
        //qwen doesn't support it; has a default value
        // tool_choice: "auto",
    }


    let anthropicResponse;
    try {
        console.log('[anthropic]sending the first request');
        anthropicResponse = await fetch(`${baseUrl}/v1/messages`, {
            method: 'POST',
            headers: requestHeader,
            body: JSON.stringify(requestBody)
        });
    } catch (error) {
        throw Error('[anthropic]API failed: ' + error.message);
    }
    if (!anthropicResponse.ok) {
        // console.log('url', anthropicResponse.url);
        // console.log('[anthropic]API not ok, body:', await anthropicResponse.text());
        throw Error('[anthropic]API not ok, status:' + anthropicResponse.status + ', body:' + await anthropicResponse.text());
    }

    let responseJson = await anthropicResponse.json();
    // console.log('[anthropic]确认解析后的 data 对象:', data);
    if (!responseJson) {
        throw Error('[anthropic]no response');
    }
    console.log('[anthropic]API response got，check if need function call...');
    if (!responseJson.content || responseJson.content.length === 0) {
        throw Error('[anthropic]response has no candidates');
    }
    const responseContents = responseJson.content
    // console.log('[anthropic]responseJson', JSON.stringify(responseJson));
    // console.log('[anthropic]responseContents', JSON.stringify(responseContents));
    let toolUses = []
    for (const responseContent of responseContents) {
        // console.log('[anthropic]responseContent', JSON.stringify(responseContent));
        if (responseContent.type === 'text') {
            console.log('[anthropic]reponseContent text: ' + responseContent.text);
        } else if (responseContent.type === 'tool_use') {
            toolUses.push(responseContent);
        } else {
            console.log('[anthropic]reponseContent ???: ' + JSON.stringify(responseContent));
        }
    }
    // console.log('[anthropic]toolUses', JSON.stringify(toolUses));
    if (!responseJson.usage) {
        throw Error('[anthropic]response has no usage');
    }

    let firstMaxPromptTokenNumber = responseJson.usage.input_tokens,
    firstCompletionTokenNumber = responseJson.usage.output_tokens,
    searchCount = 0,
    newsCount = 0,
    crawlerCount = 0;

    messages.push({
        content: responseContents,
        role: "assistant",
    });
    // console.log('[anthropic]更新后的 messages 数组:', messages);
    // 检查是否有函数调用
    // console.log('[anthropic]开始检查是否有函数调用');


    const availableFunctions = {
        "searchWeb": search,
        "searchNews": news,
        "readWebPage": crawler,
        "searchAndReadFirstResult": lucky
    };
    let calledCustomFunction = false;
    if (toolUses && toolUses.length > 0) {
        const unprocessedMessages = JSON.parse(JSON.stringify(messages));
        const resultContent = []
        for (const toolUse of toolUses) {
            const functionName = toolUse.name;
            const functionToCall = availableFunctions[functionName];
            const functionArgs = toolUse.input;
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
            functionResponse = Common.cut(functionResponse, requestBody.model, unprocessedMessages, maxTokens, toolUses.length)
            if (functionResponse != null) {
                resultContent.push({
                    "type": "tool_result",
                    "tool_use_id": toolUse.id,
                    "content": JSON.stringify(functionResponse)
                })
                calledCustomFunction = true;
            }
        }
        // console.log('[anthropic]resultContent', JSON.stringify(resultContent));
        messages.push({
            "role": "user",
            "content": resultContent
        });
    }
    // console.log('[anthropic]function call checked');

    if (!calledCustomFunction) {
        // 没有调用自定义函数，直接返回原始回复（转换为SSE）
        console.log('[anthropic]no function call needed, sending response as SSE format');
        //强制流式
        const sseStream = jsonToStream(responseJson);
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', ...corsHeaders, });
        sseStream.on('data', (chunk) => {
            res.write(chunk);
        });
        sseStream.on('end', () => {
            res.end();
        });
        // return ;
    } else {
        // 如果调用了自定义函数，再次向 API 发送请求
        console.log('[anthropic]function call needed, sending request again');
        const secondRequestBody = {
            ...requestBody,
            // tools: undefined,
            //yes it's needed
            tools: tools,
            messages: messages,
            // stream is not supported yet
            stream: false,
        };
        try {
            let secondResponse = await fetch(`${baseUrl}/v1/messages`, {
                method: 'POST',
                headers: requestHeader,
                body: JSON.stringify(secondRequestBody)
            });
            //强制流式
            console.log('[anthropic]sending second response...');
            // console.log('[anthropic]secondRequestBody', JSON.stringify(secondRequestBody));

            // return {
            //     status: secondResponse.status,
            //     headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache',...corsHeaders,
            //         'X-Shansing-First-Prompt-Token-Number': firstMaxPromptTokenNumber,
            //         'X-Shansing-First-Completion-Token-Number': firstCompletionTokenNumber,
            //         'X-Shansing-Search-Count': searchCount,
            //         'X-Shansing-News-Count': newsCount,
            //         'X-Shansing-Crawler-Count': crawlerCount,
            //     },
            //     body: secondResponse.body
            // };

            // stream is not supported yet so let's convert it to fake SSE
            const sseStream = jsonToStream(await secondResponse.json());
            res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', ...corsHeaders, });
            sseStream.on('data', (chunk) => {
                res.write(chunk);
            });
            sseStream.on('end', () => {
                res.end();
            });
        } catch (error) {
            throw Error('[anthropic]API second failed:' + error.message);
        }
    }

}

function jsonToStream(jsonData) {
    if (!jsonData?.usage?.input_tokens || !jsonData?.usage?.output_tokens) {
        console.error("[anthropic]jsonToStream content no input_tokens or output_tokens, jsonData=", JSON.stringify(jsonData))
    }
    return new Stream.Readable({
        read() {
            const pushData = () => {
                const startData = {
                    "type": "message_start",
                    "message": {
                        "id": jsonData.id,
                        "type": "message",
                        "role": "assistant",
                        "content": [],
                        "model": jsonData.model,
                        "stop_reason": null,
                        "stop_sequence": null,
                        "usage": {
                            "input_tokens": jsonData?.usage?.input_tokens || 0,
                            "output_tokens": 1
                        }
                    }
                }
                this.push(`event: message_start\ndata: ${JSON.stringify(startData)}\n\n`, 'utf8');
                this.push(`event: content_block_start\ndata: ${JSON.stringify( {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}} )}\n\n`, 'utf8');
                this.push(`event: ping\ndata: ${JSON.stringify( {"type": "ping"} )}\n\n`, 'utf8');
                let content = jsonData.content?.find(content => content?.type === 'text')?.text
                if (!content) {
                    console.error("[anthropic]jsonToStream content not found, jsonData=", JSON.stringify(jsonData))
                    content = ''
                }
                const contentData = {
                    "type": "content_block_delta",
                        "index": 0,
                        "delta": {
                        "type": "text_delta",
                            "text": content
                    }
                }
                this.push(`event: content_block_delta\ndata: ${JSON.stringify(contentData)}\n\n`, 'utf8');
                this.push(`event: content_block_stop\ndata: ${JSON.stringify( {"type":"content_block_stop","index":0} )}\n\n`, 'utf8');
                const usageData = {
                    "type": "message_delta",
                    "delta": {
                        "stop_reason": "end_turn",
                        "stop_sequence": null
                    },
                    "usage": {
                        "output_tokens": jsonData?.usage?.output_tokens || 0
                    }
                }
                this.push(`event: message_delta\ndata: ${JSON.stringify(usageData)}\n\n`, 'utf8');
                this.push(`event: message_stop\ndata: ${JSON.stringify( {"type":"message_stop"} )}\n\n`, 'utf8');
                this.push(null);  // 结束流
            };

            setTimeout(pushData, 0);
        }
    });
}

const tools = [
        {
            name: "searchWeb",
            description: "Perform a web search using specific keywords. (like Google search)",
            input_schema: {
                type: "object",
                properties: {
                    query: { type: "string","description": "Keywords for the web search."}
                },
                required: ["query"]
            }
        },
        {
            name: "searchNews",
            description: "Search for news articles using specific keywords. (like Google News)",
            input_schema: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Keywords for the news search."}
                },
                required: ["query"]
            }
        },
        {
            name: "readWebPage",
            description: "Fetch and parse the content of the given URL's webpage. (like Reader View of Firefox)",
            input_schema: {
                type: "object",
                properties: {
                    url: {
                        type: "string",
                        description: "The URL of the webpage."},
                },
                required: ["url"],
            }
        },
        {
            name: "searchAndReadFirstResult",
            description: "Perform a web search and read the content of the first search result. (like I'm Feeling Lucky of Google)",
            input_schema: {
                type: "object",
                properties: {
                    query: { type: "string","description": "Keywords for the web search."}
                },
                required: ["query"]
            }
        },
]

module.exports = handleRequest;


