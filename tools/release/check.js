#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { auditRepository } = require('./audit.js');

const root = path.resolve(__dirname, '../..');
const errors = auditRepository(root);

if (errors.length) {
  for (const error of errors) console.error(`ERROR ${error}`);
  process.exitCode = 1;
} else {
  console.log('Release check passed.');
}
