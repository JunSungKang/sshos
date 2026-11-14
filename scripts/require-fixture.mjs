console.error(`UNTESTED: ${process.argv[2] ?? 'target'} verification needs an authorized target/fixture. No production server is used by default.`);
process.exitCode = 2;
