var express    = require('express'),
    mongoStore = require('connect-mongodb'),
    argv       = require('optimist').argv,
    moment     = require('moment');
    md         = require('node-markdown').Markdown;
    mongodb    = require('mongodb');
    ci         = require("./lib");

 var routes = require('./routes/index');

AppManager = (function() {

  var port = argv.port || process.env.PORT || 3005;

  var configGLOBAL = function(app) {

    // Setup Global Message Queue.

    GLOBAL.messages       = [];
    GLOBAL.root           = __dirname;
    GLOBAL.config         = require('./config.json');
    GLOBAL.configurations = {};
    GLOBAL.app_start      = moment().format('YYYY-MM-DD HH:mm:ss');

  };

  var configureApp = function(app, db) {

    app.configure(function() {

      app.set('port', port);
      app.set('views', __dirname + '/views');
      app.set('view options', { layout: true, pretty: true });
      app.set('view engine', 'jade');

      app.use(express.logger('dev'));
      app.use(express.bodyParser());
      app.use(express.methodOverride());
      app.use(express.cookieParser('Node-CI'));

      // Define the URL params for incoming URL values.
      app.use(function(req, res, next) {
        var url = require('url');
        var queryURL = url.parse(req.url, true);
        req.urlparams = queryURL.query;
        next();
      });

      // Set the Session Storage.
      app.use(express.session({
        store: new mongoStore({ reapInterval: 600000, db: db }),
        secret: 'node-ci'
      }));

      // If no mongo access, then use session. This will force a 
      // login/oauth request each time App is restarted. This this
      // is a CI server and not a production codebase it can be used
      // without an issue for session management.

      // Uncomment to use for Session.

      // app.use(express.session({
      //   secret: 'jungleluv',
      //   store: new express.session.MemoryStore({}),
      // }))

      // Pass the session to the app.local scope.
      app.use(function(req, res, next) {
        app.locals.session = req.session;
        app.locals.page   = { title: '' };
        app.locals.md     = md;
        app.locals.server_config = GLOBAL.config;
        next();
      });

      // Define the route.
      app.use(app.router);

      // Pass specific elements to the app.local scope.
      app.locals.moment    = require('moment');
      app.locals._         = require('underscore');
      app.locals.messages  = [];
      app.locals.urlparams = {};

      // Needed by all environments.
      app.use('/', express.static(__dirname + '/'));

      // Define the default homepage or response.
      app.use(routes.ci.listProcesses);
    });
  };

  var configureRoutes = function(app) {

    // Simple Session validation check. Used for each on the routes below. If you do not
    // want security for a route, remove the check() from the route definition.

    var check = function(req, res, next ) {
      if (req.session.user && req.session.user.logged_in) {
        next();
      } else {
        res.render('login', { session: req.session, params: { message: '', goto: req.url }, title: 'Home' });
      }
    }

    // Github Oauth Paths.
    app.get('/github_login',            routes.github.login);
    app.get('/github_cb',               routes.github.callback);
    app.get('/account',                 check, routes.github.userinfo);

    // Standard Login
    app.get('/login',                   routes.session.login);
    app.get('/logout',                  routes.session.logout);

    // Git Commit Paths.
    app.get('/repos',                      check, routes.github.list);
    app.get('/repos/add',                  check, routes.github.repoAdd);
    app.get('/repos/:id/edit',             check, routes.github.repoEdit);
    app.post('/repos/update',              check, routes.github.repoUpdate);
    app.get('/repos/webhook/:id/:branch',  check, routes.webhook.trigger);

    app.get('/git/:id',               check, routes.github.commits);
    app.get('/git/:id/branches',      check, routes.github.branches);
    app.get('/git/commit/:sha',       check, routes.ci.buildCommitSlug);
    app.get('/teams',                 check, routes.github.teamMembers);

    app.get('/git/create/ref/:sha',   check, routes.github.makeReferenceDialog);
    app.post('/git/create/ref',       check, routes.github.makeReferenceAction);
    app.get('/git/ref/delete/:ref',   check, routes.github.deleteReferenceAction);

    // Mockups.
    app.get('/plots',              check, routes.data.showChart);

    // Process Paths.
    app.get('/sites',            check, routes.ci.sites);
    app.get('/list',             check, routes.ci.listProcesses);

    app.get('/provision/:id/:sha',   check, routes.ci.startDialog);
    app.post('/start/process',   check, routes.ci.startProcess);

    app.get('/stop/:uid/:index', check, routes.ci.stopProcess);
    app.get('/restart/:uid',     check, routes.ci.restartProcess);
    app.get('/cleanup',          check, routes.ci.cleanupProcesses);
    app.get('/tail/:uid',        check, routes.ci.tailProcessLog);
    app.get('/detail/:id',       check, routes.ci.processDetail);

    app.get('/activity',       check, routes.activity.list);
    app.get('/activity/:id',   check, routes.activity.delete);

    app.get('/slug/delete',       check, routes.ci.slugDelete);

    // Handles Github Web hooks payloads.
    app.post('/build',                routes.ci.catchCommitPayloadv2);

    app.get('/configurations',          check, routes.configs.list);
    app.get('/configurations/add',      check, routes.configs.add);
    app.get('/configurations/edit/:id', check, routes.configs.edit);
    app.post('/configurations/update',  check, routes.configs.editUpdate);

    app.get('/configurations/domain/add',      check, routes.configs.domainAdd);
    app.get('/configurations/domain/edit/:id', check, routes.configs.domainEdit);
    app.post('/configurations/domain/update',  check, routes.configs.domainUpdate);
    // Routes for Tests.
    app.get('/tests/delete/:id',   check, routes.tests.delete);
    app.get('/tests',              check, routes.tests.list);
    app.get('/tests/add',          check, routes.tests.add);
    app.get('/tests/edit/:id',     check, routes.tests.edit);
    app.post('/tests/update',      check, routes.tests.update);

    // Routes for Test Runs
    app.get('/runs/delete/:id',   check, routes.runs.delete);
    app.get('/runs',              check, routes.runs.list);
    app.get('/runs/add',          check, routes.runs.add);
    app.get('/runs/edit/:id',     check, routes.runs.edit);
    app.post('/runs/update',      check, routes.runs.update);

    app.get('/runs/:id/tests',     check, routes.runs.listTests);
    app.get('/runs/test/:id',      check, routes.runs.processTest);
    app.post('/runs/test/update',  check, routes.runs.processTestUpdate);

    app.get('/setup',             check, routes.system.setup);
    app.post('/setup/update',     check, routes.system.update);

    // Heroku Related Features.
    app.get("/heroku/app/:id/details", check, routes.heroku.herokuDetails );
    app.get("/heroku/app/:id/config", check, routes.heroku.herokuConfigs );
    app.get("/heroku/app/:id/contributors", check, routes.heroku.herokuContributors );
    app.get("/heroku/app/:id/addons", check, routes.heroku.herokuAddons );
    app.get("/heroku/app/:id/destroy", check, routes.heroku.herokuDeleteApp );

    app.get("/heroku/app/:id/collaborator/:cid/delete", check, routes.heroku.collaboratorRemove );
    app.post("/heroku/app/:id/collaborators/add", check, routes.heroku.collaboratorAdd );
    app.post("/heroku/app/:id/config-var/add", check, routes.heroku.configAdd );

// Add in the check agin.
    app.get("/heroku/apps",         routes.heroku.herokuList );
  
    app.get("/heroku/test",        check, routes.heroku.info );
    app.get('/quality/report',     check, routes.quality.list );
    app.post('/heroku/deploy',     check, routes.heroku.deploy );
    app.post('/build2',            routes.heroku.catchCommitPayloadv3 );

    app.get('/setup/cert', check, routes.test.file );
    
  };

  var configureCIServer = function(app, db) {
    
    var async = require('async');

    async.parallel({
      settings: function(callback) {

        var collection = new mongodb.Collection(db, 'settings');
        collection.findOne({}, function(err, result) {
          if (err) return callback(err);
          callback(null, result);
        });

      },
      repos: function(callback) {

        var collection = new mongodb.Collection(db, 'repos');
        collection.find({}).toArray(function(err, results) {
          if (err) return callback(err);
          callback(null, results);
        });

      }
    }, function(err, results) {

      app.CIServer = {
         repositories: results.repos,
         settings:     results.settings,
         version:      require('./package.json').version
      }

      app.locals.CIServer = app.CIServer;

    });

  };

  return {
    start: function(db) {
      var app = module.exports = express();

      // First configure any global variables.
      configGLOBAL(app, db);

      // Second configurate the Express APP.
      configureApp(app, db);

      // Third, not setup the routes.
      configureRoutes(app);

      // Confirm Setup
      ci.configure.start(function(err, config) {

        if (config) {
          configureCIServer(app, db);
          app.listen(port);

          console.log("Staring Express Server on port %d in %s mode", port, app.settings.env);
        } else {
          console.log("Sorry CI could not start.");
        }

      });
      
      return app;
    }
  };
})();

exports.AppManager = AppManager;