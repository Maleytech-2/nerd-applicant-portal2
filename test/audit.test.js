const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DATABASE_URL_STRING ||= "mysql://test:test@127.0.0.1/test";
const { writeAuditLog } = require("../src/middleware/audit");

test("audit logs can participate in the account-creation transaction", async () => {
  let executed = false;
  const transaction = {
    async execute(query, parameters) {
      executed = true;
      assert.match(query, /INSERT INTO audit_logs/);
      assert.equal(parameters.action, "account.created");
      assert.equal(parameters.userId, 42);
      return [{ affectedRows: 1 }];
    },
  };

  await writeAuditLog({
    userId: 42,
    action: "account.created",
    recordType: "users",
    recordId: 42,
  }, transaction);

  assert.equal(executed, true);
});
