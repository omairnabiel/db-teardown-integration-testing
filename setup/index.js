/* eslint-disable promise/prefer-await-to-then */
/* eslint-disable no-throw-literal */
/* eslint-disable no-console */
const { execSync } = require("child_process");
const path = require("path");
const { sequelize } = require("data-access-layer");

const ScriptGenerator = require("./script-generator");
const { afterEach } = require("mocha");

const triggerMigrations = ["20191105074921-add-triggers-Inquiry-model-view.js"];

const config = (() => {
  const {
    DB_DATABASE,
    DB_DATABASE_TEST,
    DB_USERNAME_TEST,
    DB_PASSWORD_TEST,
    DB_HOST_TEST,
  } = process.env;

  if (!DB_DATABASE_TEST) {
    throw new Error("Must configure a test DB in .env");
  }

  if (!DB_DATABASE_TEST.endsWith("_test")) {
    throw new Error("The name of the test DB must end in '_test'");
  }

  if (DB_DATABASE_TEST === DB_DATABASE) {
    throw new Error("Test DB is the same as the main DB. Is this intentional?");
  }

  return {
    baseDBName: `${DB_DATABASE_TEST}_base`,
    testDBName: DB_DATABASE_TEST,
    username: DB_USERNAME_TEST,
    password: DB_PASSWORD_TEST,
    host: DB_HOST_TEST,
    dumpsPath: path.resolve(__dirname, "..", "dumps"),
  };
})();

const scriptGenerator = new ScriptGenerator(config);
const tableNamesCache = {};

const retrieveTableNames = async (dbName) => {
  if (tableNamesCache[dbName] != null) {
    return tableNamesCache[dbName];
  }

  const tablesResult = await sequelize.query(
    `SELECT table_name FROM information_schema.tables where table_schema = '${dbName}'`,
    { type: sequelize.QueryTypes.SELECT },
    { logging: true }
  );

  tableNamesCache[dbName] = tablesResult.map((table) => table.table_name || table.TABLE_NAME);
  return tableNamesCache[dbName];
};

const runSQLFileScript = (sqlFilePath) => {
  const scriptPath = path.resolve(__dirname, "run-sql.sh");
  return execSync(
    `sh ${scriptPath} ${sqlFilePath} ${config.username} ${config.password} ${config.host}`,
    {
      stdio: [process.stdin, process.stdout, process.stderr],
    }
  );
};

const runSQLQuery = async (sql) => {
  await sequelize.query(sql, { raw: true, logging: false });
};

const copyDBData = async (fromDB, toDB, skipTables = []) => {
  const tableNames = await retrieveTableNames(fromDB);

  const tables = tableNames.filter((table) => !skipTables.includes(table));
  const sql = scriptGenerator.generateDataResetSql(fromDB, toDB, tables);
  return runSQLQuery(sql);
};

const copyTables = async (fromDB, toDB) => {
  const tableNames = await retrieveTableNames(fromDB);
  const sql = scriptGenerator.generateCopyTablesSql(fromDB, toDB, tableNames);
  return runSQLQuery(sql);
};

const runMigrationsOnBaseDB = async () => {
  const scriptPath = path.resolve(__dirname, "..", "..", "..", "..", "scripts", "migrate.js");

  return execSync(`node ${scriptPath}`, {
    env: { ...process.env, DB_DATABASE_TEST: config.baseDBName },
    stdio: [process.stdin, process.stdout, process.stderr],
  });
};

const runAddTriggerMigrationsOnTestDB = async () => {
  await sequelize.query(
    `DELETE FROM ${config.testDBName}.\`SequelizeMeta\` WHERE name IN (${triggerMigrations
      .map((migration) => `'${migration}'`)
      .join(",")})`
  );

  const scriptPath = path.resolve(__dirname, "..", "..", "..", "..", "scripts", "migrate.js");

  return execSync(`node ${scriptPath}`, {
    env: { ...process.env, DB_DATABASE_TEST: config.testDBName },
    stdio: [process.stdin, process.stdout, process.stderr],
  });
};

const seedDB = async (dbName) => {
  console.info(`Loading seed into DB: ${dbName}`);
  const sqlPath = scriptGenerator.generateDBSeedScript(dbName);
  return runSQLFileScript(sqlPath);
};

const createDB = async (dbName) => {
  console.info(`Creating DB: ${dbName}`);
  const sqlPath = scriptGenerator.generateCreateDBScript(dbName);
  return runSQLFileScript(sqlPath);
};

const checkIfDBExists = async (dbName) => {
  try {
    const dbCheckResult = await sequelize.query(
      `SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '${dbName}'`,
      { type: sequelize.QueryTypes.SELECT }
    );
    return dbCheckResult.length > 0;
  } catch (error) {
    const code = error.parent && error.parent.code;

    if (code === "ER_BAD_DB_ERROR") {
      return false;
    }

    throw error;
  }
};

const baseTableChecksumCache = {};

const getBaseTableCheckSumMemoized = async (dbName) => {
  const tableNames = await retrieveTableNames(dbName);

  if (baseTableChecksumCache[dbName] == null) {
    let tableChecksum = await sequelize.query(
      `CHECKSUM TABLE  ${tableNames
        .map((tableName) => `\`${dbName}\`.\`${tableName}\``)
        .join(",")}`,
      { type: sequelize.QueryTypes.SELECT }
    );

    tableChecksum = tableChecksum.map((table) => ({
      tableName: table.Table.split(".")[1],
      checksum: table.Checksum,
    }));

    baseTableChecksumCache[dbName] = tableChecksum;
  }

  return baseTableChecksumCache[dbName];
};

const getTablesToSkip = async (fromDB, toDB) => {
  const tableNames = await retrieveTableNames(fromDB);

  let toDBChecksum = await sequelize.query(
    `CHECKSUM TABLE  ${tableNames.map((tableName) => `\`${toDB}\`.\`${tableName}\``).join(",")}`,
    { type: sequelize.QueryTypes.SELECT }
  );

  const baseTableChecksum = await getBaseTableCheckSumMemoized(fromDB);

  // remove db names from tablenames i.e, <dbname>.<tablename> to <tablename>
  toDBChecksum = toDBChecksum.map((table) => ({
    tableName: table.Table.split(".")[1],
    checksum: table.Checksum,
  }));

  // filter tables with different checksum values than basetable
  const skipTables = [];
  toDBChecksum.forEach((toTable) => {
    baseTableChecksum.forEach((fromTable) => {
      if (fromTable.tableName === toTable.tableName && fromTable.checksum === toTable.checksum) {
        skipTables.push(fromTable.tableName);
      }
    });
  });
  return skipTables;
};

before(async function() {
  this.timeout(120000);

  const hasBaseDB = await checkIfDBExists(config.baseDBName);
  if (!hasBaseDB) {
    await createDB(config.baseDBName);
    await seedDB(config.baseDBName);
  }
  await runMigrationsOnBaseDB();

  await createDB(config.testDBName);

  await copyTables(config.baseDBName, config.testDBName);
  await copyDBData(config.baseDBName, config.testDBName);

  await runAddTriggerMigrationsOnTestDB();
  console.info("Finished DB setup");
});

afterEach(async function() {
  this.timeout(80000);

  const skipTables = await getTablesToSkip(config.baseDBName, config.testDBName);
  await copyDBData(config.baseDBName, config.testDBName, skipTables);
});
