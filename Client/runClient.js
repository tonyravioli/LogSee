var path = require('path')                      // For managing paths, ofcourse.
var fs = require('fs')                          // Nodes file system
var request = require('request')                // npm install request!
var lineReader = require('readline');           // For reading files from lines

// Variables
var config = JSON.parse(fs.readFileSync(path.join(__dirname + '/config.json'), 'utf8'));
var filesArray = [];       // Gets populated by init(); An array of all the files and their metadata that need checking on.
var data = {};          // Gets populated by init(); File the client uses to store small bits of data locally.

// Grabs split up metadata such as file name, ext, size, location and returns as dict
function getFileMetadata(filepath) {
    return {
        ID: null,
        filename: path.basename(filepath),
        filepath: filepath,
        size: fs.statSync(filepath).size,
        lastLine: 0
    };
};

// Go round all the files and collect their file names, size, and other things we can add in
// into a single big array of files that need scanning. Then we can just iterate over that.
function Init(callback) {
    console.log('Client Initializing...');

    // Go through all the config files, resolve them (or not) and add to the filesArray array.
    for (var f = 0; f < config['PathsToScan'].length; f++) {                                            // For every config entry
        if (fs.existsSync(config.PathsToScan[f].Location)) {                                            // If the file or dir exists
            if (fs.lstatSync(config.PathsToScan[f].Location).isFile()) {                                // If it's a file we're looking at
                filesArray.push(getFileMetadata(config.PathsToScan[f].Location));                       // Populate and push
            } else if (fs.lstatSync(config.PathsToScan[f].Location).isDirectory()) {                    // Elif its a dir
                fs.readdirSync(config.PathsToScan[f].Location).forEach(function(filename) {             // for every item in dir
                    if (path.extname(filename) == ".log") {                                             // If it's a .log and nothing but a .log file
                        filesArray.push(getFileMetadata(config.PathsToScan[f].Location + filename));    // Populate and push
                    };
                });
            } else {
                console.warn(`[Warning] I'm unable to detect what "${config.PathsToScan[f].Location}" is. It may be a socket or symlink.`);
            };
        } else {
            console.warn(`[Warning] The file "${config.PathsToScan[f].Location}" does not exist!`);
        };
    };

    // Check if we have a .data.json file to store little bits of client info, such as our unique key
    if (fs.existsSync(path.join(__dirname + '/.data.json'))) {                                          // If the .data.json file exists
        data = JSON.parse(fs.readFileSync(path.join(__dirname + '/.data.json'), 'utf8'));               // Read/Load it into the data varaible as json
    };

    // Launch the webUI as a child if configured
    if (config.WebUI.Enabled) {
        require(__dirname + '/WebUI/launchWebUI.js').WebUI.listen(config.WebUI.Port, config.WebUI.IP);
    };
    console.log('Client Initialized.');
    callback(true);
};

// Keeps the data file up to date when changing the data variable
function UpdateData() {
    fs.writeFileSync(path.join(__dirname + '/.data.json'), JSON.stringify(data));
};

// Authenticates with server
function Authenticate(callback) {
    console.log('Authenticating...');

    ////////////////////////////////////////// Developer Note //////////////////////////////////////////////////////
    // LogSee_Key   = The authentication key generated by the admin via server dashboard
    // UniqueKey    = The server-generated key given to the client after successful authentication with LogSee_Key
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    // Check that the client WebUI config isn't using the default values
    if (config.WebUI.RequireAuth && (config.WebUI.AuthUser == "admin" || config.WebUI.AuthPass == "admin")) {
        console.warn('[Critical] - The WebUI credentials are still set as default. Please change them before running the client.');
        process.exit();
    };

    // Ask if our AuthKey matches that of the servers
    request.post({url: 'http://127.0.0.1:1339/api/authenticate', json: {'AuthKey': config.Client.LogSee_Key, 'UniqueKey': data.UniqueKey}}, function(err, response, body) {
        if (response) {
            console.log('ServerAuth Response:', response.statusCode, body.Message);
            if (response.statusCode == 200) {
                console.log('Client successfully authenticated.');
                callback(true);
                // Hm... We don't actually need to do anything since the client now knows its UniqueKey
                
            } else if (response.statusCode == 201) { // The server recognised we're a newly connecting client and has given us a unique key
                data.UniqueKey = body.UniqueKey;
                UpdateData();
                Authenticate();
            } else if (response.statusCode == 401) { // Awaiting approval
                console.log('Waiting 30s to try again...');
                setTimeout(function() {
                    Authenticate();
                }, 30000); // Check again every 30 seconds
            } else if (response.statusCode == 403) { // Denied. Go away!
                process.exit();
            } else if (response.statusCode == 404) { // No unqiue key record was found, wipe our key and try again
                data.UniqueKey = null;
                UpdateData();
                console.log('Server did not recognize us. UniqueKey wiped, attemping re-authentication.');
                Authenticate();
            };
        } else if (err) {
            console.log('Could not contact the LogSee server:', err.message);
            setTimeout(function() {
                Authenticate();
            }, 30000) // Check again every 30 seconds
        };
    });
};

// Iterates over the configured files and checks for file changes, reports them.
function ScanFiles() {

    // Send all these files to the API to ensure they're in the DB, ensures the server knows what data we'll be sending it.
    request.post({url: 'http://127.0.0.1:1339/api/addfiles', json: {"Data": filesArray, "UniqueKey": data.UniqueKey}}, function(err, response, body) {
        if (response) {
            if (response.statusCode == 200) {
                filesArray = body.Message;
            };
        };
    });

    setInterval(function() {
        for (var f = 0; f < filesArray.length; f++) { // Iterate over each file
            // If the byte size != the previously logged byte size for that item, read it.
            if (fs.statSync(filesArray[f].filepath).size != filesArray[f].size) {
                filesArray[f].size = fs.statSync(filesArray[f].filepath).size; // Update its file size
                console.log(`New file size detected on file "${filesArray[f].filepath}"`);

                // What was the last line we sent for this file?
                request.post({url: 'http://127.0.0.1:1339/api/lastLine', json: {"Data": filesArray[f], "UniqueKey": data.UniqueKey}}, function(err, response, body) {
                    if (response) {
                        console.log(response.statusCode, body.Message)
                        if (response.statusCode == 200) {
                            console.log('Line Data for changes file');
                            console.log(body.Message);

                            // If last line, send from last line to current, add on line difference

                            // If not last line, send everything and count lines sent

                        };
                    };
                });
            };
        };
    }, config.Client.ScanFrequency) // Wait the ScanFrequency value, more of a safety than anything
    console.log(`Client is running.`);
};

// Lets the server know every config.Client.PingInterval seconds if it's still alive
function Pinger() {
    setInterval(function() {
        console.log('Ping');
        request.post({url: 'http://127.0.0.1:1339/api/pingpong', json: {'UniqueKey': data.UniqueKey} });
    }, config.Client.PingInterval * 1000);
};

// Javascript is wierd. Todo: Maybe turn into promises. Ugh.
Init(function(Initialized) {
    if (Initialized) {
        Authenticate(function(Authorized) {
            if (Authorized) {
                Pinger();
                ScanFiles();
            };
        });
    };
});
