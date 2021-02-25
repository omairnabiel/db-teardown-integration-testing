/* eslint-disable no-console */
/* eslint-disable import/no-extraneous-dependencies */
/**
 * Do not import this file. Run it from command line, and specify the correct env variables
 * to select the right DB.
 */
const path = require("path");

const { sequelize, Sequelize } = require("data-access-layer");
const Umzug = require("umzug");

const runMigrations = async () => {
  const migrationsPath = path.resolve(__dirname, "..", "packages", "staff-app", "migrations");

  const umzug = new Umzug({
    storage: "sequelize",
    storageOptions: { sequelize },
    migrations: {
      path: migrationsPath,
      params: [sequelize.getQueryInterface(), Sequelize],
    },
  });

  console.info("Checking for migrations to run on base DB.");

  const pendingMigrations = await umzug.pending();
  if (pendingMigrations.length > 0) {
    console.info(`Running ${pendingMigrations.length} migrations on base DB.`);
    await umzug.up();
    return true;
  }
  return true;
};

runMigrations()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);

    process.exit(1);
  });
