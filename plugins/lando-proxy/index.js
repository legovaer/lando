/**
 * Proxy plugin
 *
 * @name proxy
 */

'use strict';

module.exports = function(lando) {

  // Modules
  var _ = lando.node._;
  var fs = lando.node.fs;
  var path = require('path');
  var proxy = require('./lib/proxy');
  var routes = require('./lib/routes');

  // Fixed location of our proxy service compose file
  var proxyFile = path.join(lando.config.userConfRoot, 'proxy', 'proxy.yml');
  var projectName = 'landoproxyhyperion5000gandalfedition';
  var networkName = [projectName, 'edge'].join('_');

  // Get the compose object
  var proxyRunner = proxy.compose(proxyFile, projectName);

  // Add some config for the proxy
  lando.events.on('post-bootstrap', 1, function(lando) {

    // Log
    lando.log.info('Configuring proxy plugin');

    // Proxy defaults
    var defaultProxyConfig = {
      proxy: 'ON',
      proxyDomain: 'lndo.site',
      proxyDash: '58086',
      proxyHttpPort: '80',
      proxyHttpsPort: '443',
      proxyHttpFallbacks: ['8000', '8080', '8888', '8008'],
      proxyHttpsFallbacks: ['444', '4433', '4444', '4443']
    };

    // Merge config over defaults
    lando.config = lando.utils.config.merge(defaultProxyConfig, lando.config);

    // Construct lists
    var http = [lando.config.proxyHttpPort, lando.config.proxyHttpFallbacks];
    var https = [lando.config.proxyHttpsPort, lando.config.proxyHttpsFallbacks];
    lando.config.proxyHttpPorts = _.flatten(http);
    lando.config.proxyHttpsPorts = _.flatten(https);

    // Log it
    lando.log.verbose('Proxy plugin configured with %j', lando.config);
    lando.log.info('Initializing proxy plugin');

  });

  // Turn the proxy off on powerdown if applicable
  lando.events.on('poweroff', function() {
    if (lando.config.proxy === 'ON' && fs.existsSync(proxyFile)) {
      return lando.engine.stop(proxyRunner);
    }
  });

  // Turn on the proxy automatically and get info about its urls
  lando.events.on('post-instantiate-app', function(app) {

    // If the proxy is on and our app has config
    if (lando.config.proxy === 'ON' && !_.isEmpty(app.config.proxy)) {

      /*
       * Scan ports to find available ones for proxy
       */
      var scanPorts = function(config) {

        var u = proxy.getUrls(config.proxyHttpPorts, false, config.engineHost);
        var u2 = proxy.getUrls(config.proxyHttpsPorts, true, config.engineHost);

        // Determine the ports for our proxy
        return lando.Promise.all([
          lando.scanUrls(u, {max: 1, waitCodes: []}),
          lando.scanUrls(u2, {max: 1, waitCodes: []})
        ])

        // Discover ports and return object
        .map(function(data) {
          return proxy.getPort(data);
        })

        .then(function(ports) {
          return {http: ports[0], https: ports[1]};
        });

      };

      /*
       * Helper to get ports from a started proxy
       */
      var getPorts = function() {

        // Scan the proxy again
        return lando.engine.scan(proxyRunner)

        // Get its ports
        .then(function(data) {
          var config = lando.config;
          return proxy.pp(data, config.proxyHttpPort, config.proxyHttpsPort);
        });

      };

      app.events.on('pre-start', 1, function() {

        // Do some port discovery
        return lando.Promise.try(function() {

          // If there is no proxy file then lets scan the ports
          if (!fs.existsSync(proxyFile)) {
            return scanPorts(lando.config);
          }

          // If the proxy has been created already lets see if we can use that
          else {

            // Inspect current proxy to make sure we dont incorrectly rebuild
            return lando.engine.scan(proxyRunner)

            // If the proxy is running, lets make sure we hook up the ports that the proxy
            // is already using. If we dont do this the proxy will always show as "changed"
            .then(function(data) {

              // Get things
              var run = _.get(data, 'State.Running', false);
              var ph = lando.config.proxyHttpPort;
              var phs = lando.config.proxyHttpsPort;

              // Return active info or scanned stuff
              return (run) ? proxy.pp(data, ph, phs) : scanPorts(lando.config);

            });

          }
        })

        // Set and start the proxy
        .then(function(ports) {

          var domain = lando.config.proxyDomain;
          var proxyDash = lando.config.proxyDash;
          var data = proxy.build(domain, proxyDash, ports.http, ports.https);

          // If we are building the proxy for the first time
          if (!fs.existsSync(proxyFile)) {
            lando.log.verbose('Starting proxy for the first time');
            lando.yaml.dump(proxyFile, data);
          }

          // Get the current proxy
          var proxyOld = lando.yaml.load(proxyFile);

          // If the proxy is different, rebuild with new and stop the old
          if (JSON.stringify(proxyOld) !== JSON.stringify(data)) {
            lando.log.verbose('Proxy has changed, rebuilding');
            lando.yaml.dump(proxyFile, data);
          }

        })

        // Try to start the proxy
        .then(function() {

          // Retry this a few times so we can cover situations like
          // https://github.com/lando/lando/issues/632
          // This is important because if the proxy fails it sort of botches the whole thing
          return lando.Promise.retry(function() {

            // Start the proxy
            return lando.engine.start(proxyRunner)

            // If there is an error let's destroy and try to recreate
            .catch(function(error) {
              lando.log.warn('Something is wrong with the proxy! %j', error);
              lando.log.warn('Trying to take corrective action...');
              var id = [projectName, 'proxy', '1'].join('_');
              return lando.engine.destroy({id: id, opts: {force: true}})
              .then(function() {
                return lando.Promise.reject();
              });
            });

          });

        })

        // Get the data and parerse the services
        .then(function() {

          // At this point we can reliably get ports because we should be started
          return getPorts()

          // Parse services
          .then(function(ports) {

            // Transform our config into services objects
            var services = _.map(app.config.proxy || {}, function(data, key) {

              // If this is the new proxy config format lets translate it to the old one
              if (!_.isEmpty(data) && _.isString(data[0])) {
                data = routes.map2Legacy(data, app.name);
              }

              // Map each route into an object of ports and urls
              var rs = _.map(data, function(r) {
                return routes.getLegacyRouteUrls(r, app.name, ports);
              });

              // Return the service
              return {app: app.name, name: key, routes: rs};

            });

            // Get a count of the URLs so we can check for dupes
            var urlCount = routes.getUrlsCounts(services);
            var hasDupes = _.reduce(urlCount, function(result, count) {
              return count > 1 || result;
            }, false);

            // Throw an error if there are dupes
            if (hasDupes) {
              lando.log.error('Duplicate URL detected: %j', urlCount);
            }

            // Return the list
            return services;

          });

        })

        // Go through those services one by one
        .map(function(service) {

          // Get name  port and hosts
          var port = _.get(service, 'routes[0].port', '80');
          var hosts = routes.stripPorts(service);
          if (port === 443) { port = 80; }

          // Add in relevant labels if we have hosts
          if (!_.isEmpty(hosts)) {

            // Get parse hosts
            var parsedHosts = routes.parseHosts(hosts);

            // Start building the augment
            return {
              name: service.name,
              service: {
                networks: {'lando_proxyedge': {}},
                labels: {
                  'traefik.docker.network': networkName,
                  'traefik.frontend.rule': 'HostRegexp:' + parsedHosts,
                  'traefik.port': _.toString(port)
                }
              }
            };

          }

        })

        // Spit out the proxy compose file
        .then(function(services) {

          // Get the tl compose object
          var compose = routes.compose(networkName);

          // Loop and add in
          _.forEach(services, function(service) {
            compose.services[service.name] = service.service;
          });

          // Get project name
          var project = app.project || app.name;

          // Write the services
          var projectDir = path.dirname(proxyFile);
          var fileName = [project, 'proxy', _.uniqueId()].join('-');
          var file = path.join(projectDir, fileName + '.yml');

          // Add that file to our compose list
          app.compose.push(lando.yaml.dump(file, compose));
          lando.log.verbose('App %s has proxy compose file %s', project, file);

        });
      });

      // Add proxy URLS to our app info
      app.events.on('post-info', function() {

        // If the proxy is on and our app has config
        if (lando.config.proxy === 'ON' && !_.isEmpty(app.config.proxy)) {

          // Kick off the chain by seeing if our app is up
          return lando.app.isRunning(app)

          // If app is not running then we are done
          .then(function(isRunning) {
            if (isRunning) {

              // SHoul dbe good to get ports
              return getPorts()

              // Map the config to a list of info urls
              .then(function(ports) {
                var info = routes.map2Info(app.config.proxy, ports);
                app.info = lando.utils.config.merge(app.info, info);
              });

            }
          });

        }

      });

    }

  });

};
