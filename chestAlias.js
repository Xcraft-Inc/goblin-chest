const {Elf} = require('xcraft-core-goblin');
const {ChestAlias, ChestAliasLogic} = require('./lib/chestAlias.js');

exports.xcraftCommands = Elf.birth(ChestAlias, ChestAliasLogic);
