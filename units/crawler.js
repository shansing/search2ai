const fetch = require('node-fetch');
const jsdom = require("jsdom");
const Readability = require('@mozilla/readability');
const NodeHtmlMarkdown = require('node-html-markdown');
const process = require("process");

async function crawler(url) {
    console.log(`crawler: ${url}`);
    try {
        const html = await fetch(url, {
            method: 'GET',
            headers: {
                "User-Agent": process.env.CRAWL_UA,
                "Accept": "*/*",
                "Accept-Language": "en;q=0.8",
                "Accept-Encoding": "gzip",
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin",
                "DNT": "1",
                "Sec-GPC": "1",
                "Pragma": "no-cache",
                "Cache-Control": "no-cache",
                "TE": "trailers",
            },
            redirect: "follow",
        }).then(res => res.text());
        const dom = new jsdom.JSDOM(html);

        const reader = new Readability.Readability(dom.window.document);
        const article = reader.parse();

        const markdown = NodeHtmlMarkdown.NodeHtmlMarkdown.translate(article?.content || '', {});

        return JSON.stringify({
            title: article.title,
            markdown: markdown
        })
    } catch (error) {
        console.error(`Error fetching or processing URL: ${error}`);
        throw error
    }
}


// 爬取函数，调用你的爬取服务
// async function crawler(url) {
//     console.log(`正在使用 URL 进行自定义爬取:${JSON.stringify(url)}`);
//     try {
//         const response = await fetch('https://crawler.search2ai.one', {
//             method: 'POST',
//             headers: {
//                 "Content-Type": "application/json"
//             },
//             body: JSON.stringify({
//                 url: url
//             })
//         });
//
//         if (!response.ok) {
//             console.error(`API 请求失败, 状态码: ${response.status}`);
//             return `API 请求失败, 状态码: ${response.status}`;
//         }
//
//         const contentType = response.headers.get("content-type");
//         if (!contentType || !contentType.includes("application/json")) {
//             console.error("收到的响应不是有效的 JSON 格式");
//             return "收到的响应不是有效的 JSON 格式";
//         }
//
//         const data = await response.json();
//         console.log('自定义爬取服务调用完成');
//         return JSON.stringify(data);
//     } catch (error) {
//         console.error(`在 crawler 函数中捕获到错误: ${error}`);
//         return `在 crawler 函数中捕获到错误: ${error}`;
//     }
// }
module.exports = crawler;
