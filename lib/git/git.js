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
        const stderr = [];
        proc.stderr.on('data', (data) => {
          stderr.push(data.toString());
        });

        proc.on('error', (e) => {
          error.push(e.toString());
        });

        proc.on('close', (code) => {
          if (error.length || code) {
            const err = new Error(
              `Git command ${args[0]}: ${error.join('')}\n\n${stderr.join('')}`
            );
            reject(err);
          } else {
            resolve(stdout.join(''));
          }
        });
      });
  }

  async remoteUrl() {
    const output = await this.#git('remote', 'get-url', 'origin');
    return output?.trim();
  }

  async checkout(branch) {
    return await this.#git('checkout', branch);
  }

  async clone(url, branch = 'master') {
    return await this.#git('clone', '-b', branch, url, this.#outputDir);
  }

  async add(...files) {
    await this.#git('add', ...files);
  }

  async rm(...files) {
    await this.#git('rm', '-f', ...files);
  }

  async commit() {
    return await this.#git('commit', '-m', 'Update files');
  }

  async pull() {
    return await this.#git('pull', '-f');
  }

  async push() {
    return await this.#git('push');
  }

  async reset() {
    await this.#git('reset', '--hard', 'HEAD');
  }

  async staged() {
    try {
      await this.#git('diff', '--cached', '--quiet');
      return false; /* Nothing in staging */
    } catch {
      return true; /* Something in staging */
    }
  }

  static get available() {
    return !!which.sync('git', {nothrow: true});
  }
}

module.exports = Git;
