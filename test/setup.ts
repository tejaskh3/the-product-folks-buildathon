// Model calls in tests never leave the machine: fetch is stubbed per test.
process.env.OPENROUTER_API_KEY ??= "sk-or-test";
