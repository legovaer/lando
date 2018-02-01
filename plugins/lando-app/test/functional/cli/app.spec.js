'use strict';

const CliTest = require('command-line-test');
const chai = require('chai');
const path = require('path');
const fs = require('fs');
const os = require('os');
const jsYaml = require('js-yaml');
const should = chai.should();

describe('App Commands', function() {
  this.timeout(50000);
  // Setup a temp dir to play in.
  before(function() {
    this.appFolder = fs.mkdtempSync(
      path.join(os.tmpdir(), 'lando-test-'),
      (err, folder) => {
        if (err) { throw err; }
        return folder;
      }
    );

    // Create a temporary app
    const app = {
      'name': 'lando-test',
      'services': {
        'node': {
          'type': 'node:8.9',
          'image': 'docker/hello-world'
        },
        'redis': {
          'type': 'redis:4.0',
          'image': 'docker/hello-world'
        }
      }
    };

    fs.writeFileSync(
      `${this.appFolder}${path.sep}.lando.yml`,
      jsYaml.dump(app),
      'utf8',
      (err) => { if (err) { throw err; } }
    );
  });

  beforeEach(function() {
    // We'll need this in all tests
    this.cliTest = new CliTest();
    // Use the entry-point in the app, not on the machine.
    this.executable = path.resolve(
      __dirname, '..', '..', '..', '..', '..', 'bin', 'lando.js'
    );
  });

  describe('start', function() {
    it('Starts all containers on an app', function() {
      return this.cliTest.execFile(this.executable, ['start'], {cwd: this.appFolder}).then((res) => {
        should.not.exist(res.error);
      });
    });
  });

  describe('stop', function() {
    it('Stops all containers on an app', function() {
      return this.cliTest.execFile(this.executable, ['stop'], {cwd: this.appFolder}).then((res) => {
        should.not.exist(res.error);
      })
    })
  })
});
