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
        throw Error('[google]Method Not Allowed');
    }
    const requestData = req.body;
    // console.log('[google]requestData: ', requestData);
    let baseUrl = req.headers["x-shansing-base-url"];
    console.log('[google]baseUrl: ', baseUrl);
    if (!baseUrl) {
        // throw Error('[google]no baseUrl provided');
        baseUrl = 'https://generativelanguage.googleapis.com'
        console.log('[google]using default baseUrl');
    }
    const requestHeader = {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Authorization": req.headers["authorization"],
    }

    if (!requestData.generationConfig) {
        requestData.generationConfig = {}
    }
    const maxTokens = requestData?.generationConfig?.maxOutputTokens || 2000;

    const contents = requestData.contents;
    // const userMessages = requestData.contents.filter(content => content.role === 'user');
    // const latestUserMessage = userMessages[userMessages.length - 1];
    // const latestUserMessageContent = latestUserMessage.content;

    let requestBody = requestData;
    const queryArray = req.url.split('?')
    if (queryArray.length !== 2) {
        throw Error('[google]No key provided')
    }
    const path = queryArray[0]
    const query = queryArray[1]
    let model = path.split("/")?.slice(3).join("/");
    if (model == null || model.includes("/")) {
        throw Error('[google]Unable to match model')
    }
    model = model.split(':')[0]

    requestBody.generationConfig.maxOutputTokens = maxTokens;
    requestBody = {
        ...requestBody,
        tools: tools,
    }

    let googleResponse;
    try {
        console.log('[google]sending the first request');
        googleResponse = await fetch(`${baseUrl}/v1beta/models/${model}:generateContent?${query}`, {
            method: 'POST',
            headers: requestHeader,
            body: JSON.stringify(requestBody)
        });
    } catch (error) {
        throw Error('[google]API failed: ' + error.message);
    }
    if (!googleResponse.ok) {
        // console.log('url', googleResponse.url);
        // console.log('[google]API not ok, body:', await googleResponse.text());
        throw Error('[google]API not ok, status:' + googleResponse.status + ', body:' + await googleResponse.text());
    }

    let responseJson = await googleResponse.json();
    // console.log('[google]确认解析后的 data 对象:', data);
    if (!responseJson) {
        throw Error('[google]no response');
    }
    console.log('[google]API response got，check if need function call...');
    if (!responseJson.candidates || responseJson.candidates.length === 0 || !responseJson.candidates[0].content
        || responseJson.candidates[0].content.role !== 'model' || !responseJson.candidates[0].content.parts) {
        throw Error('[google]response has no candidates');
    }
    const functionCalls = responseJson.candidates[0].content.parts
        .filter(part => !!part.functionCall)
        .map(part => part.functionCall)
    if (!responseJson.usageMetadata) {
        throw Error('[google]response has no usage');
    }

    let firstMaxPromptTokenNumber = responseJson.usageMetadata.promptTokenCount,
    firstCompletionTokenNumber = responseJson.usageMetadata.candidatesTokenCount,
    searchCount = 0,
    newsCount = 0,
    crawlerCount = 0;

    contents.push({
        ...responseJson.candidates[0].content,
        "role": "model",
    });
    // console.log('[google]更新后的 messages 数组:', messages);
    // 检查是否有函数调用
    // console.log('[google]开始检查是否有函数调用');


    const availableFunctions = {
        "searchWeb": search,
        "searchNews": news,
        "readWebPage": crawler,
        "searchAndReadFirstResult": lucky
    };
    let calledCustomFunction = false;
    if (functionCalls && functionCalls.length > 0) {
        const unprocessedContents = JSON.stringify(contents);
        const responseParts = []
        for (const functionCall of functionCalls) {
            const functionName = functionCall.name;
            const functionToCall = availableFunctions[functionName];
            const functionArgs = functionCall.args;
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
            functionResponse = Common.cut(functionResponse, model, unprocessedContents, maxTokens, functionCalls.length)
            if (functionResponse != null) {
                responseParts.push({
                    "functionResponse": {
                        "name": functionName,
                        "response": functionResponse
                    }
                })
                calledCustomFunction = true;
            }
        }
        //貌似没有并行调用，不知道并行调用会不会是这样返回的
        contents.push({
            "role": "function",
            "parts": responseParts
        });
    }
    // console.log('[google]function call checked');

    if (!calledCustomFunction) {
        // 没有调用自定义函数，直接返回原始回复（转换为SSE）
        console.log('[google]no function call needed, sending response as SSE format');
        //强制流式
        const sseStream = jsonToStream(responseJson);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-cache', ...corsHeaders, });
        sseStream.on('data', (chunk) => {
            res.write(chunk);
        });
        sseStream.on('end', () => {
            res.end();
        });
        // return ;
    } else {
        // 如果调用了自定义函数，再次向 API 发送请求
        console.log('[google]function call needed, sending request again');
        const secondRequestBody = {
            ...requestBody,
            // tools: undefined,
            // tool_config: undefined,
            //right, it's needed
            tools: tools,
            contents: contents,
        };
        try {
            let secondResponse = await fetch(`${baseUrl}/v1beta/models/${model}:streamGenerateContent?${query}`, {
                method: 'POST',
                headers: requestHeader,
                body: JSON.stringify(secondRequestBody)
            });
            //强制流式
            console.log('[google]sending second response...');
            // console.log('[google]secondRequestBody', JSON.stringify(secondRequestBody));

            return {
                status: secondResponse.status,
                headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-cache',...corsHeaders,
                    'X-Shansing-First-Prompt-Token-Number': firstMaxPromptTokenNumber,
                    'X-Shansing-First-Completion-Token-Number': firstCompletionTokenNumber,
                    'X-Shansing-Search-Count': searchCount,
                    'X-Shansing-News-Count': newsCount,
                    'X-Shansing-Crawler-Count': crawlerCount,
                },
                body: secondResponse.body
            };
        } catch (error) {
            throw Error('[google]API second failed:' + error.message);
        }
    }

}

function jsonToStream(jsonData) {
    return new Stream.Readable({
        read() {
            const pushData = () => {
                this.push(`[${JSON.stringify(jsonData)}\n]`, 'utf-8')
                this.push(null);  // 结束流
            };

            setTimeout(pushData, 0);
        }
    });
}

const tools = [
    {
        "function_declarations": [
            {
                name: "searchWeb",
                description: "Perform a web search using specific keywords. (like Google search)",
                parameters: {
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
                parameters: {
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
                parameters: {
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
                parameters: {
                    type: "object",
                    properties: {
                        query: { type: "string","description": "Keywords for the web search."}
                    },
                    required: ["query"]
                }
            },
        ]
    }
]

module.exports = handleRequest;


