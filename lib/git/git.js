// @ts-check
'use strict';

const which = require('which');
const {spawn} = require('node:child_process');

class Git {
  #git;
  #outputDir;

  constructor(outputDir) {
    this.#outputDir = outputDir;
    this.#git = (...args) =>
      new Promise((resolve, reject) => {
        const env = {...process.env, ...{LANG: 'C'}};
        const git = which.sync('git');
        if (!git) {
          reject(new Error('git binary not found'));
          return;
        }
        const options = {env};
        if (args[0] !== 'clone') {
          options.cwd = this.#outputDir;
        }
        const proc = spawn(git, args, options);
        const error = [];
        const stdout = [];
        proc.stdout.on('data', (data) => {
          stdout.push(data.toString());
        });

        proc.on('error', (e) => {
          error.push(e.toString());
        });

        proc.on('close', () => {
          if (error.length) {
            reject(error.join(''));
          } else {
            resolve(stdout.join(''));
          }
        });
      });
  }

  async checkout(branch) {
    return await this.#git('checkout', branch);
  }

  async clone(url) {
    return await this.#git('clone', url, this.#outputDir);
  }

  async commit() {
    await this.#git('add', '-u');
    return await this.#git('commit', '-m', 'Update files');
  }

  async pull() {
    return await this.#git('pull', '-f');
  }

  async push() {
    return await this.#git('push');
  }

  static get available() {
    return !!which.sync('git', {nothrow: true});
  }
}

module.exports = Git;
