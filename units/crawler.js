const fetch = require('node-fetch');
const jsdom = require("jsdom");
const Readability = require('@mozilla/readability');
const NodeHtmlMarkdown = require('node-html-markdown');
const process = require("process");
const {AbortError} = require("node-fetch");

async function crawler(url) {
    console.log(`crawler:`, url);
    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort();
    }, 6_000);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
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
        })

        const contentTypeHeader = response.headers.get('Content-Type');
        const mimeType = contentTypeHeader ? contentTypeHeader.split(';')[0].trim().toLowerCase() : null;
        console.log("crawler MIME Type:", mimeType);
        let result;
        if (!mimeType) {
            result = await userNinjaAi(url)
        } else if (mimeType === 'text/html') {
            result = await processHtml(response, url)
        } else if (mimeType.startsWith('text/') || mimeType.includes('markdown')) {
            result = {
                title: mimeType,
                url: url,
                content: await response.text(),
            }
        } else { // if (mimeType.includes('pdf'))
            // pdf and the others
            result = await userNinjaAi(url)
        }

        console.log('crawler done', url);
        return result
    } catch (error) {
        if (error instanceof AbortError) {
            console.error('crawler AbortError', error);
            throw Error('Timeout, the request has been interrupted. The specified webpage may be unreachable.');
        } else {
            console.error(`Error fetching or processing URL: ${error}`);
            throw error
        }
    } finally {
        clearTimeout(timeout);
    }
}

async function processHtml(response, url) {
    const html = await response.text();
    const dom = new jsdom.JSDOM(html);

    const reader = new Readability.Readability(dom.window.document);
    const article = reader.parse();
    const content = article?.content || ''
    const title = article?.title || dom.window.document?.title || '';
    const markdown = NodeHtmlMarkdown.NodeHtmlMarkdown.translate(content, {})
    return {
        title: title,
        url: url,
        content: markdown,
    }
}

async function userNinjaAi(url) {
    console.log(`crawler userNinjaAi`, url);
    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort();
    }, 6_000);
    try {
        const response = await fetch('https://r.jina.ai/' + url, {
            signal: controller.signal,
            method: 'GET',
            redirect: "follow",
        })
        const text = await response.text();

        const lines = text.trim().split('\n');
        let title = "";
        if (lines.length > 0) {
            const firstLine = lines[0];
            if (firstLine.startsWith("Title: ")) {
                title = firstLine.substring("Title: ".length).trim();
            }
        }
        let content = text
        const indexContent = content.indexOf('Markdown Content:');
        if (indexContent !== -1) {
            content = content.substring(indexContent + 'Markdown Content:'.length +　1, content.length);
        }

        return {
            title: title,
            url: url,
            content: content,
        }
    } finally {
        clearTimeout(timeout);
    }
}

module.exports = crawler;
