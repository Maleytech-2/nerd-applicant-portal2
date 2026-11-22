const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const pool = require("./database");

const options = {
  createDatabaseTable: true,
  schema: {
    tableName: "sessions",
    columnNames: {
      session_id: "session_id",
      expires: "expires",
      data: "data",
    },
  },
};

function createSessionStore() {
  return new MySQLStore(options, pool);
}

module.exports = { createSessionStore };
