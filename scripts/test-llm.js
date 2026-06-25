const { complete } = require("../lib/llm");

(async () => {
  const result = await complete({
    json: true,
    system: "Output { leakage_type, urgency, reasoning }.",
    user: "Cart abandoned 2 hrs ago for Queen hybrid mattress. Include leakage_type."
  });
  console.log(result);
})();
