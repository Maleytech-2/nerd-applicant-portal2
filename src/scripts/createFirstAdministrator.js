require("dotenv").config();
const bcrypt = require("bcrypt");
const db = require("../config/database");

async function createFirstAdministrator() {
  const fullName = process.env.INIT_ADMIN_FULL_NAME;
  const email = process.env.INIT_ADMIN_EMAIL;
  const phone = process.env.INIT_ADMIN_PHONE;
  const password = process.env.INIT_ADMIN_PASSWORD;
  if (!fullName || !email || !phone || !password) {
    throw new Error(
      "Set INIT_ADMIN_FULL_NAME, INIT_ADMIN_EMAIL, INIT_ADMIN_PHONE, and INIT_ADMIN_PASSWORD before running this script."
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("INIT_ADMIN_EMAIL is not valid.");
  }
  if (!/^\+?[0-9]{7,15}$/.test(phone)) {
    throw new Error("INIT_ADMIN_PHONE is not valid.");
  }
  if (password.length < 14) {
    throw new Error("INIT_ADMIN_PASSWORD must contain at least 14 characters.");
  }

  const [existing] = await db.execute(
    `SELECT u.id
     FROM users u
     JOIN roles r ON r.id=u.role_id
     WHERE r.name='administrator'
     LIMIT 1`
  );
  if (existing.length) {
    throw new Error("An administrator already exists.");
  }

  const [roles] = await db.execute("SELECT id FROM roles WHERE name='administrator' LIMIT 1");
  if (!roles[0]) throw new Error("Administrator role is missing. Run database initialization first.");
  const passwordHash = await bcrypt.hash(password, 12);
  const [result] = await db.execute(
    `INSERT INTO users (
       role_id, full_name, email, phone, password_hash,
       password_changed_at, is_active, email_verified_at
     ) VALUES (
       :roleId, :fullName, :email, :phone, :passwordHash,
       CURRENT_TIMESTAMP, TRUE, CURRENT_TIMESTAMP
     )`,
    {
      roleId: roles[0].id,
      fullName,
      email: email.toLowerCase(),
      phone,
      passwordHash,
    }
  );
  console.log(`First administrator created with user ID ${result.insertId}.`);
  await db.end();
}

createFirstAdministrator().catch((error) => {
  console.error("Administrator bootstrap failed:", error.message);
  process.exit(1);
});
