const fetch = require('node-fetch');
const jsdom = require("jsdom");
const Readability = require('@mozilla/readability');
const NodeHtmlMarkdown = require('node-html-markdown');
const process = require("process");

async function crawler(url) {
    console.log(`crawler:`, url);
    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort();
    }, 10_000);
    try {
        const html = await fetch(url, {
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
        }).then(res => res.text());
        const dom = new jsdom.JSDOM(html);

        const reader = new Readability.Readability(dom.window.document);
        const article = reader.parse();
        const content = article?.content || ''
        const title = article?.title || dom.window.document?.title || '';
        const markdown = NodeHtmlMarkdown.NodeHtmlMarkdown.translate(content, {});
        console.log('crawler done', url);
        return {
            title: title,
            url: url,
            content: markdown,
        }
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

module.exports = {crawler, CrawlerResult};
