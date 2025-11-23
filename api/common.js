const tokenizer = require("gpt-tokenizer");
const runes = require('runes')

const Common = (function() {

    const modelThresholdTokenNumbers = [
        { name: "gpt-5.1-chat", total: 128_000, prompt: null, completion: 16_384 },
        { name: "gpt-5.1", total: 400_000, prompt: null, completion: 128_000 },
        { name: "gpt-5-chat", total: 128_000, prompt: null, completion: 16_384 },
        { name: "gpt-5", total: 400_000, prompt: null, completion: 128_000 },
        { name: "gpt-4.1", total: 1_047_576, prompt: null, completion: 32_768 },
        {
            name: "gpt-4o-search",
            total: 128_000,
            prompt: null,
            completion: 16_384,
        },
        {
            name: "gpt-4o-mini-search",
            total: 128_000,
            prompt: null,
            completion: 16_384,
        },
        {
            name: "gpt-4o-2024-11-20",
            total: 128_000,
            prompt: null,
            completion: 16_384,
        },
        {
            name: "gpt-4o-2024-08-06",
            total: 128_000,
            prompt: null,
            completion: 16_384,
        },
        { name: "gpt-4o-mini", total: 128_000, prompt: null, completion: 16_384 },
        { name: "gpt-4o", total: 128_000, prompt: null, completion: 4_096 },
        { name: "chatgpt-4o", total: 128_000, prompt: null, completion: 16_384 },
        {
            name: "gpt-4.5",
            total: 128_000,
            prompt: null,
            completion: 16_384,
        },
        { name: "gpt-4-turbo", total: 128_000, prompt: null, completion: 4_096 },
        { name: "gpt-4", total: 8192, prompt: null, completion: 4_096 },
        { name: "gpt-3.5-turbo", total: 16385, prompt: null, completion: 4_096 },
        { name: "o1-preview", total: 128_000, prompt: null, completion: 32_768 },
        { name: "o1-mini", total: 128_000, prompt: null, completion: 65_536 },
        { name: "o1", total: 200_000, prompt: null, completion: 100_000 },
        { name: "o3-mini", total: 200_000, prompt: null, completion: 100_000 },
        { name: "o4-mini", total: 200_000, prompt: null, completion: 100_000 },
        { name: "qwq-plus", total: 131_072, prompt: 98_304, completion: 8_192 },
        { name: "qwen-turbo", total: null, prompt: 6_000, completion: 1500 },
        { name: "qwen-plus", total: null, prompt: 30_000, completion: 2000 },
        {
            name: "qwen-max-longcontext",
            total: null,
            prompt: 28_000,
            completion: 2000,
        },
        { name: "qwen-max-latest", total: null, prompt: 30_720, completion: 8_192 },
        { name: "qwen-max", total: null, prompt: 6_000, completion: 2000 },
        { name: "qwen-long", total: null, prompt: 9_000, completion: 2000 }, // total is not 10_000_000
        { name: "gemini-2.5-", total: null, prompt: 200_000, completion: 65_536 }, //prompt under 200k is cheap
        { name: "gemini-2.0-", total: null, prompt: 1_048_576, completion: 8192 },
        { name: "gemini-", total: null, prompt: 128_000, completion: 8192 }, //1.5flash 1,048,576;  1.5pro 2,097,152;  but under 128k is cheap
        {
            name: "anthropic/claude-3.5-haiku",
            total: 200_000,
            prompt: null,
            completion: 8200,
        },
        {
            name: "anthropic/claude-haiku-4",
            total: 200_000,
            prompt: null,
            completion: 64_000,
        },
        {
            name: "anthropic/claude-sonnet-4",
            total: 200_000,
            prompt: null,
            completion: 64_000,
        },
        {
            name: "anthropic/claude-3.7",
            total: 200_000,
            prompt: null,
            completion: 64_000,
        },
        {
            name: "anthropic/claude-3.5-sonnet",
            total: 200_000,
            prompt: null,
            completion: 8_000,
        },
        { name: "claude-3-5-", total: 200_000, prompt: null, completion: 8192 },
        { name: "claude-3-", total: 200_000, prompt: null, completion: 4096 },
        { name: "claude-2.1", total: 200_000, prompt: null, completion: 4096 },
        { name: "claude-", total: 100_000, prompt: null, completion: 4096 },
        {
            name: "deepseek/deepseek-chat",
            total: 64_000,
            prompt: null,
            completion: 8_000,
        },
        {
            name: "deepseek/deepseek-r1-0528",
            total: 163_000,
            prompt: null,
            completion: 32_000,
        },
        {
            name: "deepseek/deepseek-r1",
            total: 64_000,
            prompt: null,
            completion: 64_000,
        },
        {
            name: "deepseek-chat",
            total: 128_000,
            prompt: null,
            completion: 8_000,
        },
        {
            name: "deepseek-reasoner",
            total: 128_000,
            prompt: null,
            completion: 64_000,
        },
        { name: "qwen/qwq-32b", total: 131_000, prompt: null, completion: 131_000 },
        {
            name: "perplexity/sonar-deep-research",
            total: 200_000,
            prompt: null,
            completion: 200_000,
        },
        { name: "grok-4", total: 128_000, prompt: null, completion: 128_000 }, //under 128k is cheap
        { name: "grok-3", total: 131_000, prompt: null, completion: 131_000 },
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


