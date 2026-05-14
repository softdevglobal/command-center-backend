/** Runs before `env-bootstrap` / dotenv so v17 “◇ injected env …” lines stay off. */
process.env.DOTENV_CONFIG_QUIET ??= "true";
