const tokenizer = require("gpt-tokenizer");
const runes = require('runes')

const Common = (function() {

    const modelThresholdTokenNumbers = [
        {
            name: "gpt-4o-2024-08-06",
            total: 128_000,
            prompt: null,
            completion: 16_384,
        },
        { name: "gpt-4o", total: 128_000, prompt: null, completion: 4_096 },
        { name: "gpt-4o-mini", total: 128_000, prompt: null, completion: 16_384 },
        { name: "chatgpt-4o", total: 128_000, prompt: null, completion: 16_384 },
        { name: "gpt-4-turbo", total: 128_000, prompt: null, completion: 4_096 },
        { name: "gpt-4", total: 8192, prompt: null, completion: 4_096 },
        { name: "gpt-3.5-turbo", total: 16385, prompt: null, completion: 4_096 },
        { name: "qwen-turbo", total: null, prompt: 6_000, completion: 1500 },
        { name: "qwen-plus", total: null, prompt: 30_000, completion: 2000 },
        {
            name: "qwen-max-longcontext",
            total: null,
            prompt: 28_000,
            completion: 2000,
        },
        { name: "qwen-max", total: null, prompt: 6_000, completion: 2000 },
        { name: "qwen-long", total: null, prompt: 9_000, completion: 2000 }, // total is not 10_000_000
        { name: "gemini-", total: null, prompt: 128_000, completion: 8192 }, //1.5flash 1,048,576,000;  1.5pro 2,097,152,000;  but under 128k is cheap
        { name: "claude-3-", total: 200_000, prompt: null, completion: 4096 },
        { name: "claude-2.1", total: 200_000, prompt: null, completion: 4096 },
        { name: "claude-", total: 100_000, prompt: null, completion: 4096 },
        { name: "", total: 4_000, prompt: null, completion: null }, //default
    ];

    const calculatePromptTokenThreshold = function (model, maxCompletionToken, knownPromptNumber) {
        const modelThresholdTokenNumber = modelThresholdTokenNumbers?.find((obj) =>
            model.startsWith(obj.name),
        );
        if (modelThresholdTokenNumber?.total != null) {
            return (
                modelThresholdTokenNumber.total - maxCompletionToken - knownPromptNumber
            );
        } else if (modelThresholdTokenNumber?.prompt != null) {
            return modelThresholdTokenNumber.prompt - knownPromptNumber;
        } else {
            return 4000 - maxCompletionToken - knownPromptNumber;
        }
    };

    const cut = function (json, modelName, unprocessedMessageString, maxCompletionTokenNumber, divisor) {
            // console.log("cut...")
            const maxPromptTokenNumber = Math.round(calculatePromptTokenThreshold(modelName, maxCompletionTokenNumber, 0) * 0.9 / divisor)

            let searchCutCount = 0, cutLength = 0
            if (json.content && json?.content?.length || 0 > 0) {
                //先裁剪内容（如果有）
                let estimatedText = JSON.stringify(json) + unprocessedMessageString;
                //非常粗略的估计
                if (!tokenizer.isWithinTokenLimit(estimatedText, maxPromptTokenNumber)) {
                    const gptTokens = tokenizer.encode(estimatedText);
                    let goodLength = Math.floor(estimatedText.length / gptTokens.length * maxPromptTokenNumber)
                    while (!tokenizer.isWithinTokenLimit(fitLength(estimatedText, goodLength, false), maxPromptTokenNumber)) {
                        if (goodLength <= 50) {
                            break;
                        }
                        goodLength -= 20
                    }
                    cutLength = estimatedText.length - goodLength
                    json.content = fitLength(json.content, json.content.length - cutLength, true);
                }
            }
            while (!tokenizer.isWithinTokenLimit(JSON.stringify(json) + unprocessedMessageString, maxPromptTokenNumber)) {
                //再移出搜索结果（如果有）
                if (!json.allSearchResults || json.allSearchResults.length === 0) {
                    break;
                }
                json.allSearchResults.pop()
                searchCutCount++
            }
            console.log("cut done", {
                modelName,
                maxCompletionTokenNumber,
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

        const middle = '\n[...Content is omitted...]\n'
        function fitLength(content, goodLength, accurate) {
            if (content.length <= goodLength) {
                return content
            }
            if (goodLength <= middle.length) {
                return middle
            }
            //留头留尾去中间
            const halfLength = Math.floor(goodLength)
            const start = accurate
                ? runes.substr(content, 0, halfLength)
                : content.substring(0, halfLength);
            let endStartIndex = content.length - halfLength + middle.length;
            let end;
            if (endStartIndex > content.length) {
                end = ""
            } else {
                end = accurate
                    ? runes.substr(content, endStartIndex)
                    : content.substring(endStartIndex);
            }
            return start + middle + end
        }

    return {
        cut: cut
    };
})();

module.exports = Common;


