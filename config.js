'use strict';

const path = require('path');
const fse = require('fs-extra');

module.exports = [
  {
    type: 'list',
    name: 'backend',
    message: 'backend for the storage',
    choices: fse
      .readdirSync(path.join(__dirname, 'lib/backend'))
      .filter((file) => file.endsWith('.js'))
      .map((file) => path.basename(file, '.js')),
    default: 'fs',
  },
  {
    type: 'input',
    name: 'fs.location',
    message: 'location to store the files',
    default: null,
  },
  {
    type: 'input',
    name: 'fs.maxSize',
    message:
      'max size for the storage (no limit if 0, otherwise size in bytes)',
    default: 0,
  },
  {
    type: 'input',
    name: 'fs.cipher',
    message: 'default cipher to use for encryption',
    default: 'aes-256-cbc',
  },
  {
    type: 'input',
    name: 'fs.compress',
    message: 'default compression to use for encryption',
    default: 'gzip',
  },
  {
    type: 'input',
    name: 'collect.orphans.maxSize',
    message:
      'max size of orphans to keep in the database / storage (collect without limit if 0)',
    default: 0,
  },
  {
    type: 'input',
    name: 'chronomancer.missing.time',
    message: 'CRON time for database check',
    default: '0 */1 * * *',
  },
  {
    type: 'input',
    name: 'chronomancer.collect.time',
    message: 'CRON time for trashed backend files to collect',
    default: '42 3 * * *',
  },
  {
    type: 'checkbox',
    name: 'gold.namespaces',
    message: 'Supported namespaces for the gold warden',
    default: [],
  },
];
