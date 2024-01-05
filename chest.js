const {Elf} = require('xcraft-core-goblin');
const {Chest, ChestLogic} = require('./lib/chest.js');

exports.xcraftCommands = Elf.birth(Chest, ChestLogic);
