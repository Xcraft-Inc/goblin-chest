const {Elf} = require('xcraft-core-goblin');
const {Gold, GoldLogic} = require('./lib/gold.js');

exports.xcraftCommands = Elf.birth(Gold, GoldLogic);
