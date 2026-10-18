# Provider configurations

Store non-secret provider configuration templates here (provider name, endpoint, default model, capabilities). API keys must not be stored in committed JSON/TOML/YAML files.

Recommended pattern:
- commit `provider.example.json` with harmless defaults;
- store real credentials in the OS credential store or a local encrypted secret store;
- let runtime configuration reference a secret by ID, never embed the secret value.

Provider adapters should normalize requests and responses into the core message/tool/event types.
