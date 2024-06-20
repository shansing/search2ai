const fetch = require('node-fetch');
const jsdom = require("jsdom");
const Readability = require('@mozilla/readability');
const NodeHtmlMarkdown = require('node-html-markdown');
const process = require("process");
const {AbortError} = require("node-fetch");
const dns = require('dns');
const net = require('net');

async function crawler(url) {
    console.log(`crawler:`, url);
    if (url && !url.startsWith('http')) {
        url = "http://" + url
    }
    let urlAllowed
    try {
        urlAllowed = await isUrlAllowed(url);
    } catch (error) {
        throw Error('Hostname cannot be resolved; ' + error.message)
    }
    if (!urlAllowed) {
        throw Error('Intranet Addresses Forbidden!')
    }
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
            result = await useNinjaAi(url)
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
            result = await useNinjaAi(url)
        }

        console.log('crawler done', url);
        return result
    } catch (error) {
        if (error instanceof AbortError) {
            console.error('crawler AbortError, try using ninja ai', error);
            return await useNinjaAi(url)
            // throw Error('Timeout, the request has been interrupted. The specified webpage may be unreachable.');
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

async function useNinjaAi(url) {
    const ninjaUrl = 'https://r.jina.ai/' + url
    console.log(`crawler useNinjaAi`, ninjaUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort();
    }, 6_000);
    try {
        const response = await fetch(ninjaUrl, {
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

function isLocalOrIntranetAddress(ip) {
    const ipv4PrivateRanges = [
        /^10\./,
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
        /^192\.168\./,
        /^127\./,
        /^169\.254\./,
        /^0\./
    ];

    const ipv6PrivateRanges = [
        /^::1$/, // localhost
        /^fe80::/i, // link-local
        /^fc00::/i, // unique local address
        /^fd00::/i, // unique local address
        /^::ffff:10\./i, // IPv4-mapped IPv6 address for 10.0.0.0/8
        /^::ffff:172\.(1[6-9]|2[0-9]|3[0-1])\./i, // IPv4-mapped IPv6 address for 172.16.0.0/12
        /^::ffff:192\.168\./i, // IPv4-mapped IPv6 address for 192.168.0.0/16
        /^::ffff:127\./i, // IPv4-mapped IPv6 address for 127.0.0.0/8
        /^::ffff:169\.254\./i, // IPv4-mapped IPv6 address for 169.254.0.0/16
        /^::ffff:0\./i // IPv4-mapped IPv6 address for 0.0.0.0/8
    ];

    if (net.isIPv4(ip)) {
        return ipv4PrivateRanges.some(range => range.test(ip));
    } else if (net.isIPv6(ip)) {
        return ipv6PrivateRanges.some(range => range.test(ip));
    }
    return false;
}

function isUrlAllowed(url) {
    try {
        const parsedUrl = new URL(url);
        const hostname = parsedUrl.hostname;

        return new Promise((resolve, reject) => {
            dns.resolve(hostname, (err, addresses) => {
                if (err) {
                    return reject(err);
                }

                const isAllowed = addresses.every(address => !isLocalOrIntranetAddress(address));
                resolve(isAllowed);
            });
        });
    } catch (error) {
        return Promise.reject(error);
    }
}


module.exports = crawler;
