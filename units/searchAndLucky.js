const search = require("./search");
const crawler = require("./crawler");

async function searchAndLucky(query) {
    console.log(`searchAndLucky:`, query);
    try {
        const searchResult = await search(query)
        if (!searchResult.allSearchResults || searchResult.allSearchResults.length === 0) {
            return JSON.stringify({
                allSearchResults: []
            })
        }
        const url = searchResult.allSearchResults[0].url;
        const crawlerResult = await crawler(url)
        console.log(`searchAndLucky done`, query);
        return {
            ...crawlerResult,
            allSearchResults: searchResult.allSearchResults
        }
    } catch (error) {
        console.error(`Error fetching or processing URL: ${error}`);
        throw error
    }
}

module.exports = searchAndLucky;
