const fs = require("fs");
const path = require("path");

class ScriptGenerator {
  constructor({ dumpsPath, baseDBName, testDBName }) {
    this.dumpsPath = dumpsPath;
    this.tempPath = path.join(this.dumpsPath, "temp");
    this.baseDBName = baseDBName;
    this.testDBName = testDBName;
  }

  generateCreateDBScript(dbName) {
    const templatePath = path.resolve(this.dumpsPath, `create-db-template.sql`);
    const scriptPath = path.join(this.tempPath, `create-db-${dbName}.sql`);
    let content = fs.readFileSync(templatePath, "utf8");
    content = content.replace(/{{DATABASE_NAME}}/g, dbName);
    fs.writeFileSync(scriptPath, content, "utf8");
    return scriptPath;
  }

  generateDBSeedScript(dbName) {
    const templatePath = path.resolve(this.dumpsPath, `seed.sql`);
    const scriptPath = path.join(this.tempPath, `seed-${dbName}.sql`);

    let content = fs.readFileSync(templatePath, "utf8");
    content = content.replace(/{{DATABASE_NAME}}/g, dbName);
    fs.writeFileSync(scriptPath, content, "utf8");

    return scriptPath;
  }

  generateCopyTablesSql(fromDB, toDB, tableNames) {
    return [
      "SET FOREIGN_KEY_CHECKS = 0;",
      ...tableNames.map(
        (table) => `CREATE TABLE \`${toDB}\`.\`${table}\` LIKE \`${fromDB}\`.\`${table}\`;`
      ),
      "SET FOREIGN_KEY_CHECKS = 1;",
    ].join("\n");
  }

  generateDataResetSql(fromDB, toDB, tableNames) {
    return [
      "SET FOREIGN_KEY_CHECKS = 0;",
      ...tableNames.map((table) =>
        [
          `TRUNCATE TABLE \`${toDB}\`.\`${table}\`;`,
          `INSERT INTO \`${toDB}\`.\`${table}\` SELECT * FROM \`${fromDB}\`.\`${table}\`;`,
        ].join("\n")
      ),
      "SET FOREIGN_KEY_CHECKS = 1;",
    ].join("\n");
  }
}

module.exports = ScriptGenerator;
