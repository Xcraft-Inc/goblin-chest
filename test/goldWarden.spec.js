// @ts-check
'use strict';

const path = require('node:path');
const fse = require('fs-extra');
const {setTimeout: setTimeoutAsync} = require('node:timers/promises');
const {expect} = require('chai');
const {Elf} = require('xcraft-core-goblin/lib/test.js');
const {GoldWarden} = require('../lib/goldWarden.js');
const {GoldLogic, GoldShape} = require('../lib/gold.js');

describe('goblin.chest.goldWarden', function () {
  let runner;
  const goldPath = path.join(__dirname, 'share');
  const testWorkflow = path.join(goldPath, 'workflows/temp-workflow');

  this.beforeAll(function () {
    runner = new Elf.Runner();
    runner.init();
  });

  this.afterAll(function () {
    runner.dispose();
    fse.removeSync(testWorkflow);
  });

  it('watch', async function () {
    this.timeout(process.env.NODE_ENV === 'development' ? 1000000 : 40000);

    /** @this {Elf} */
    async function test() {
      let golds = [];
      const goldWarden = new GoldWarden(this);
      await goldWarden.init({goldPath});
      const reader = await this.cryo.reader(GoldLogic.db);

      const repository = await goldWarden.repository();
      expect(repository).to.be.equals(goldPath);

      await setTimeoutAsync(3000);

      /* Check for test workflows directory */
      golds = reader.queryArchetype('gold', GoldShape).field('id').all();
      expect(golds.length).length.to.be.equals(2);
      expect(golds).includes('gold@workflows@test%2Dworkflow@index%2Ejs');
      expect(golds).includes('gold@workflows@test%2Dworkflow@workflow%2Ejson');

      /* Add new files */
      await fse.mkdir(testWorkflow);
      await fse.writeFile(
        path.join(testWorkflow, 'bragon.js'),
        '// Le Chevalier Bragon'
      );

      await setTimeoutAsync(6000);

      /* Check for new workflow */
      golds = reader.queryArchetype('gold', GoldShape).field('id').all();
      expect(golds.length).length.to.be.equals(3);
      expect(golds).includes('gold@workflows@test%2Dworkflow@index%2Ejs');
      expect(golds).includes('gold@workflows@test%2Dworkflow@workflow%2Ejson');
      expect(golds).includes('gold@workflows@temp%2Dworkflow@bragon%2Ejs');

      /* Remove files */
      await fse.remove(testWorkflow);

      await setTimeoutAsync(6000);

      /* Check for test workflows directory */
      golds = reader.queryArchetype('gold', GoldShape).field('id').all();
      expect(golds.length).length.to.be.equals(2);
      expect(golds).includes('gold@workflows@test%2Dworkflow@index%2Ejs');
      expect(golds).includes('gold@workflows@test%2Dworkflow@workflow%2Ejson');
    }

    await runner.it(test);
  });
});
