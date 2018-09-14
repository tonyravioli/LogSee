var childProcess = require('child_process')     // For launching the WebUI as a child process of client.
var path = require('path')                      // For managing paths, ofcourse.
var fs = require('fs')                          // Nodes file system
var crypto = require('crypto')                  // For generating / encrypting bits n bobs
var request = require('request')                // npm install request!

// Variables
console.log(__dirname);
var config = JSON.parse(fs.readFileSync(path.join(__dirname + '/config.json'), 'utf8'));
var scanArr = [];       // Gets populated by init(); An array of all the files and their metadata that need checking on.
var loggedIn = null;    // Gets populated by boolean response from Authenticate();
var data = {};          // Gets populated by init(); File the client uses to store small bits of data locally.

// Go round all the files and collect their file names, size, and other things we can add in
// into a single big array of files that need scanning. Then we can just iterate over that.
function Init() {
    console.log('Client Initializing...');

    for (var f = 0; f < config['PathsToScan'].length; f++) { // For every config entry
        if (fs.existsSync(config.PathsToScan[f].Location)) { // If the file or dir exists
            var tfd = config.PathsToScan[f] // This file or dir  (tf)
            if (fs.lstatSync(tfd.Location).isFile()) { // If it's a file we're looking at
                // Populate all its data and push it
                tfd.filename = path.basename(tfd.Location);
                tfd.size = fs.statSync(tfd.Location).size;
                scanArr.push(tfd);
            } else if (fs.lstatSync(tfd.Location).isDirectory()) { // Elif its a dir
                fs.readdirSync(tfd.Location).forEach(function(filename) { // for every item in dir
                    if (path.extname(filename) == ".log") { // If it's a .log and nothing but a .log file, append
                        // Populate all its data and push it
                        tfd.filename = filename;
                        tfd.Location = tfd.Location + filename;
                        tfd.size = fs.statSync(tfd.Location).size;
                        scanArr.push(tfd);
                    };
                });
            } else {
                console.warn(`[Warning] I'm unable to detect what "${config.PathsToScan[f].Location}" is. It may be a socket or symlink.`);
            };
        } else {
            console.warn(`[Warning] The file "${config.PathsToScan[f].Location}" does not exist!`);
        };
    };

    //Todo: For every file pushed to the array, check if they exist in the database, if so, populate metadataa such as how many lines the database holds compared to the file

    // Do we have a .data.json file for storing some of our stuff in?
    if (fs.existsSync(path.join(__dirname + '/.data.json'))) {
        data = JSON.parse(fs.readFileSync(path.join(__dirname + '/.data.json'), 'utf8'));
    };

    // Launch the webUI as a child if configured
    if (config.WebUI.Enabled) {
        childProcess.fork(path.join(__dirname + '/WebUI/launchWebUI.js'));
    };
    console.log('Client Initialized.');
    Authenticate(); // Login to the server
};

// Keeps the data file up to date when changing the data variable
function UpdateData() {
    fs.writeFileSync(path.join(__dirname + '/.data.json'), JSON.stringify(data));
};

// Authenticates with server
function Authenticate() {
    console.log('Authenticating...');
    if (config.Client.LogSee_Username == "admin" || config.Client.LogSee_Password == "admin") {
        console.warn('[Critical] - LogSee credentials are still default. Please change them before running the client.');
        process.exit();
    };

    // Ask if our AuthKey matches that of the servers
    if (config.Client.LogSee_Key && !data.UniqueKey) {
        console.log('Registering client for first time authentication...');
        var options = {
            url: 'http://127.0.0.1:1339/api/authenticate',
            json: {'AuthKey': config.Client.LogSee_Key}
        };
        request.post(options, function(err, response, body) {
            // If success
            if (response.statusCode == 200) {
                console.log(response.statusCode, body.Message);
                data.UniqueKey = body.UniqueKey;
                UpdateData();
            } else { // If unsuccess (due to errors or failed key)
                console.log(response.statusCode, body.Message)
            }
        });
    } else if (data.UniqueKey && config.Client.LogSee_Key) { // We have an auth + unique key
        console.log('Client already registered... Checking status...');
        var options = {
            url: 'http://127.0.0.1:1339/api/authenticate',
            json: {'AuthKey': config.Client.LogSee_Key, 'UniqueKey': data.UniqueKey}
        };
        request.post(options, function(err, response, body) {
            console.log(response.statusCode, body.Message);
            if (response.statusCode == 200) {
                console.log('Client successfully authenticated.')
                Pinger();
                ScanFiles();
            } else if (response.statusCode == 404) { // No unqiue key record was found, generate a new one
                data.UniqueKey = null;
                UpdateData();
                console.log('Server did not recognize us. A new UniqueKey has been generated and attemping re-authentication.')
                Authenticate();
            };
            // else process.exit(); ? Or have it run every x seconds if status is 401 (still awaiting approval)
        });
    } else {
        console.log('Unable to authenticate with the server as no LogSee_Key has been given.\nPlease create a key via the server dashboard and insert it into the config file.')
        process.exit();
    };
};

// Iterates over the configured files and checks for file changes, reports them.
function ScanFiles() {
    setInterval(function() {
        // Iterate over each file
        for (var f = 0; f < scanArr.length; f++) {
            tf = scanArr[f]; // This File (tf)
            // If the byte size != the previously logged byte size for that item, read it.
            if (fs.statSync(tf.Location).size != tf.size) {
                tf.size = fs.statSync(tf.Location).size; // Update its file size
                console.log(`New file size detected on file "${tf.filename}"`);
                // Todo: IF Metadata.lastLineSent, send from that line
            };
        };
    }, config.Client.ScanFrequency) // Wait the ScanFrequency value
    console.log(`Client is running.`);
};

// Lets the server know every config.Client.PingInterval seconds if it's still alive
function Pinger() {
    setInterval(function() {
        request.post({url: 'http://127.0.0.1:1339/api/pingpong', json: {'UniqueKey': data.UniqueKey} });
    }, config.Client.PingInterval * 1000)
};

Init(); // Run