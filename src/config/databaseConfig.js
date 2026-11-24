function parseDatabaseUrl(databaseUrl = process.env.DATABASE_URL_STRING || process.env.DATABASE_URL) {
  if (!databaseUrl) {
    if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME) {
      const port = Number(process.env.DB_PORT || 3306);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("DB_PORT must contain a valid port.");
      }
      return {
        host: process.env.DB_HOST,
        port,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD || "",
        database: process.env.DB_NAME,
      };
    }
    throw new Error("DATABASE_URL_STRING is required. Use mysql://user:password@host:3306/database.");
  }

  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL_STRING must be a valid MySQL connection URL.");
  }

  if (!["mysql:", "mysql2:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL_STRING must use the mysql:// or mysql2:// scheme.");
  }

  let database;
  let user;
  let password;
  let host;
  try {
    database = decodeURIComponent(url.pathname.slice(1));
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
    host = decodeURIComponent(url.hostname);
  } catch {
    throw new Error("DATABASE_URL_STRING contains invalid URL encoding.");
  }
  if (!url.hostname || !user || !database) {
    throw new Error("DATABASE_URL_STRING must include a username, host, and database name.");
  }

  const port = url.port ? Number(url.port) : 3306;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("DATABASE_URL_STRING must include a valid port.");
  }

  const options = {};
  for (const [key, value] of url.searchParams) {
    if (["host", "port", "user", "password", "database"].includes(key)) continue;
    try {
      options[key] = JSON.parse(value);
    } catch {
      options[key] = value;
    }
  }

  return {
    ...options,
    host: host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host,
    port,
    user,
    password,
    database,
  };
}

function getDatabaseConfig({ includeDatabase = true } = {}) {
  const config = parseDatabaseUrl();
  if (!includeDatabase) delete config.database;
  return config;
}

module.exports = { getDatabaseConfig, parseDatabaseUrl };
