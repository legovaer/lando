'use strict';

const CliTest = require('command-line-test');
const chai = require('chai');
const expect = chai.expect;
const path = require('path');
const fs = require('fs');
const os = require('os');
const jsYaml = require('js-yaml');

chai.should();

const Docker = require('dockerode');


describe('App Commands', function() {
  this.timeout(50000);
  // Setup a temp dir to play in.
  before(function() {
    this.docker = new Docker();
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
          'type': 'node:8.9'
        },
        'redis': {
          'type': 'redis:4.0'
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

  describe('#start', function() {
    it('Starts all containers on an app', function() {
      return this.cliTest.execFile(this.executable, ['start'], {cwd: this.appFolder})
      .then((res) => {
        const nodeContainer = this.docker.getContainer('landotest_node_1');
        nodeContainer.inspect(function(err, data) {
          if (err) { throw err; }
          return data.State.should.have.property('Status', 'running');
        });
        const redisContainer = this.docker.getContainer('landotest_redis_1');
        redisContainer.inspect(function(err, data) {
          if (err) { throw err; }
          return data.State.should.have.property('Status', 'running');
        });
      });
    });
    // The proxy seems to REALLLLY slow down the test, skip for now.
    it('Provides proxied URLs to the user');
  });

  describe('#stop', function() {
    it('Stops all containers on an app', function() {
      return this.cliTest.execFile(this.executable, ['stop'], {cwd: this.appFolder}).then((res) => {
        const nodeContainer = this.docker.getContainer('landotest_node_1');
        nodeContainer.inspect(function(err, data) {
          if (err) { throw err; }
          return data.State.should.have.property('Status', 'exited');
        });
        const redisContainer = this.docker.getContainer('landotest_redis_1');
        redisContainer.inspect(function(err, data) {
          if (err) { throw err; }
          return data.State.should.have.property('Status', 'exited');
        });
      });
    });
  });

  describe('#destroy', function() {
    it('Removes all containers', function() {
      return this.cliTest.execFile(this.executable, ['destroy', '-y'], {cwd: this.appFolder})
      .then((res) => this.docker.listContainers((err, data) => {
          if (err) { throw err; }
          let ourCotainers = [];
          ourCotainers = data.filter(
            (container) => container.Names.includes('/landotest_node_1') ||
            container.Names.includes('/landotest_redis_1')
          );
          expect(ourCotainers).to.be.an('array').that.is.empty;
        }));
    });
  });

  describe('#info', function() {
    it('returns json', function() {
      return this.cliTest.execFile(this.executable, ['config']).then((res) => {
        // This could get risky as the output could have
        // non-standard JSON we need to trim.
        const getJson = function() {
          JSON.parse(res.stdout);
        };
        expect(getJson).to.not.throw('SyntaxError');
      });
    });

    it('shows info on all services', function() {
      return this.cliTest.execFile(this.executable, ['info'], {cwd: this.appFolder})
      .then((res) => {
        const data = JSON.parse(res.stdout);
        data.should.have.property('redis');
        data.redis.should.have.property('internal_connection');
        return data.should.have.property('node');
      });
    })
  });
});
