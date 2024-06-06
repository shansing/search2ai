const tokenizer = require("gpt-tokenizer");
const runes = require('runes')

const Common = (function() {

    const modelMaxTotalTokenNumber = [
            {name: "gpt-4o", number: 128_000},
            {name: "gpt-4-turbo", number: 128_000},
            {name: "gpt-4", number: 8192},
            {name: "gpt-3.5-turbo", number: 16385},
            {name: "qwen-turbo", number: 6_000},
            {name: "qwen-plus", number: 30_000},
            {name: "qwen-max-longcontext", number: 28_000},
            {name: "qwen-max", number: 6_000},
            {name: "qwen-long", number: 9_000}, // it's not 10_000_000
            {name: "qwen-vl-", number: 6_000},
            {name: "gemini-", number: 128_000},
            { name: "claude-3-", number: 200_000 },
            { name: "claude-2.1", number: 200_000 },
            { name: "claude-", number: 100_000 },
            {name: "", number: 4_000} //default
        ],

        cut = function (json, modelName, unprocessedMessages, maxCompletionTokenNumber, divisor) {
            // console.log("cut...")
            const maxTotalTokenNumber = modelMaxTotalTokenNumber.find(obj => modelName.startsWith(obj.name)).number || 4000
            const maxPromptTokenNumber = Math.round((maxTotalTokenNumber - maxCompletionTokenNumber) / divisor)
            let searchCutCount = 0, cutLength = 0
            //非常粗略的估计
            while (!tokenizer.isWithinTokenLimit(JSON.stringify({json, unprocessedMessages}), maxPromptTokenNumber)) {
                //先移出搜索结果（如果有）
                if (!json.allSearchResults || json.allSearchResults.length === 0) {
                    break;
                }
                json.allSearchResults.pop()
                searchCutCount++
            }
            if (json.content && json?.content?.length || 0 > 0) {
                //再裁剪内容（如果有）
                let estimatedText = JSON.stringify({json, unprocessedMessages});
                if (!tokenizer.isWithinTokenLimit(estimatedText.substring(0, estimatedText.length), maxPromptTokenNumber)) {
                    const gptTokens = tokenizer.encode(estimatedText);
                    cutLength = estimatedText.length - Math.round(estimatedText.length / gptTokens.length * maxPromptTokenNumber)
                    while (!tokenizer.isWithinTokenLimit(estimatedText.substring(0, estimatedText.length - cutLength), maxPromptTokenNumber)) {
                        if (json.content.length - cutLength <= 50) {
                            break;
                        }
                        cutLength += 10
                    }
                    json.content = runes.substr(json.content, 0, json.content.length - cutLength);
                }
            }
            console.log("cut done", {
                modelName,
                maxCompletionTokenNumber,
                maxTotalTokenNumber,
                divisor,
                maxPromptTokenNumber,
                searchCutCount,
                cutLength,
                leftSearchResults: json?.allSearchResults?.length || 0,
                leftContentLength: json?.content?.length || 0,
            })
            // console.log(json.content)
            // if (!tokenizer.isWithinTokenLimit(JSON.stringify({json, existedMessages}), maxPromptTokenNumber)) {
            //     throw Error("Need too many tokens; unable to cut the prompts to fit the requirement. Please try to clear the history messages, or provide a smaller max_tokens, or switch to a model allowing more context-tokens. " +
            //         "maxTotalTokenNumber=" + maxTotalTokenNumber + ", maxPromptTokenNumber=" + maxPromptTokenNumber)
            // }
            return json
        }

    return {
        cut: cut
    };
})();

module.exports = Common;


