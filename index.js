var port 		= 80,
	fs 			= require('fs'),
    express 	= require('express'),
    io 			= require('socket.io'),
    handler		= require('./handler.js'),
    web 		= express(),
	listen 		= web.listen(port), // Set express listening to the assigned port
	io 			= io(listen); // Use the same port as express to recieve socket.io connections

console.log('[DEBUG] Setting up the environment ...');
console.log('[DEBUG] Application is listening to %d', port);
console.log('[DEBUG] Retrieving the initial data');
handler.retrieveData(io); // Collect the initial data, store in cache and broadcast to all connected users
console.log('[DEBUG] Estabilishing timed update');
setInterval(function() {
	handler.retrieveData(io); // Contact the API verifying if there is a new round
}, 5000); // Every 5 seconds

/*
	================== socket.io
*/
io.on('connection', function(socket){ // Executes the callback whenever a new socket.io connection is made
	handler.emitCache(socket); // Retrieve stored price cache and broadcast to the new user
});

/*
	================== Express
*/
web.set('view engine', 'ejs');
web.get('/', function(request, response) {
  	var index 		= fs.readFileSync('./resources/index.jade', {encoding: 'utf8'}); // Loads the homepage HTML from the file and encodes in UTF-8
  	response.end(index); // Returns a response for the user's request
});
web.get('/resources/:script', function(request, response) { // Redirect all request made to /resources to the respective file
  	var html = fs.readFileSync("./resources/"+request.params.script); // Load the file requested
  	response.end(html); // Returns a response for the user's request
});