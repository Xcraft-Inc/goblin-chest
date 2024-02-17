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
    name: 'chronomancer.time',
    message: 'CRON time for database check',
    default: '0 */1 * * *',
  },
];
