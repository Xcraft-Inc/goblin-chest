// @ts-check
'use strict';

const {spawn} = require('node:child_process');

class Git {
  #git;
  #outputDir;

  constructor(outputDir) {
    this.#outputDir = outputDir;
    this.#git = (...args) =>
      new Promise((resolve, reject) => {
        const env = {...process.env, ...{LANG: 'C'}};
        const cp = spawn('git', args, {
          cwd: this.#outputDir,
          env,
        });
        const error = [];
        const stdout = [];
        cp.stdout.on('data', (data) => {
          stdout.push(data.toString());
        });

        cp.on('error', (e) => {
          error.push(e.toString());
        });

        cp.on('close', () => {
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

  async clone(repository) {
    return await this.#git('clone', repository, this.#outputDir);
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
    const which = require('which');
    return !!which.sync('git', {nothrow: true});
  }
}

module.exports = Git;
