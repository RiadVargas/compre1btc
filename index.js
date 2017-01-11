var client = require('node-rest-client').Client,
    fs = require('fs'),
    express = require('express'),
    handlebars = require('handlebars'),
    io = require('socket.io'),
    math   = require('mathjs'),
    cache = require( "node-cache" );

var port = 80;
console.log('[DEBUG] Setting up the environment ...');
var app = express(),
	listen = app.listen(port),
	io = io(listen),
	client = new client(),
	priceCache = new cache();
console.log('[DEBUG] Application is listening to %d', port);
console.log('[DEBUG] Retrieving the initial data');
retrieveData();
console.log('[DEBUG] Estabilishing timed update');
setInterval(function() {
	retrieveData();
}, 5000);

app.set('view engine', 'ejs');
app.get('/', function(req, res) {
  var index = fs.readFileSync('./resources/index.jade'),
  		source      = index.toString('utf8'),
      	template    = handlebars.compile(source),
      	context     = priceCache.get('price'),
      	order_book  = {},
      	round, obj, url;
  var html    = template(context);
  res.end(html);
});
app.get('/resources/:script', function(req, res) {
  	var html = fs.readFileSync("./resources/"+req.params.script);
  	res.end(html);
});

io.on('connection', function(socket){
	priceCache.get('buy', function(err, value) {
		socket.emit('buy', value);
	});
	priceCache.get('sell', function(err, value) {
		socket.emit('sell', value);
	});
});

function retrieveData() {
	var obj, url, result, round;
	url = "https://s3.amazonaws.com/data-production-walltime-info/production/dynamic/meta.json?now="+Date.now();
	client.get(url, function (data, response) {
		obj = parseData(data);
		priceCache.get('buy', function(err, value) {
			if(err || !value) {
				console.log('[DEBUG] Error while trying to get cache, assuming it\'s empty.');
				return updatePrice(obj);
			}
			if(value.round == obj.current_round) return console.log('[DEBUG] Same round, skipping.');
			return updatePrice(obj);
		});
	}).on('error', function (err) {
		console.log('something went wrong on the request', err.request.options);
	});
}

function updatePrice(response) {
	var obj, url, result, amount = 1, total, diff;
	for (var i = 0; i <= response.order_book_pages - 1; i++) {
		url     = "https://s3.amazonaws.com/data-production-walltime-info/production/dynamic/"+response.order_book_prefix+"_r"+response.current_round+"_p"+i+".json";
		client.get(url, function (data) {	
			obj = parseData(data);
			if(obj == null) {
				retrieveData();
				return console.error('[DEBUG] Metadata empty, retrying ...');
			}
			obj['xbt-brl'].some(function(value) {
				value[0] = math.eval(value[0]);
				value[1] = math.eval(value[1]);
				if(value[0] >= amount) {
					total     = math.sum(total, math.multiply(math.divide(value[1], value[0]), amount));
					amount    = 0;
				}
				else {
					amount    = math.subtract(amount, value[0]);
					total     = math.sum(total, value[1]);
				}
				if(amount == 0) {      	
					result     = { 
						price: total, 
						timestamp: obj.timestamp, 
						round: response.current_round, 						
						date: new Date(obj.timestamp)
					};
					priceCache.set('buy', result);
					io.sockets.emit('update', result);
					console.log('[DEBUG] [BUY] [R%d] [%d] New round arrived.', result.round, result.price);
					return true;
				}
			});
			amount = 1;
			total = 0;
			obj['brl-xbt'].some(function(value) {				
				value[0] = math.eval(value[0]);
				value[1] = math.eval(value[1]);
				if(value[1] >= amount) {
					total     = math.sum(total, math.multiply(math.divide(value[0], value[1]), amount));
					amount    = 0;
				}
				else {
					amount    = math.subtract(amount, value[1]);
					total     = math.sum(total, value[0]);
				}
				if(amount == 0) {      	
					result     = { 
						price: total, 
						timestamp: obj.timestamp, 
						round: response.current_round, 
						date: new Date(obj.timestamp)
					};
					priceCache.set('sell', result);
					io.sockets.emit('sell', result);
					console.log('[DEBUG] [SELL] [R%d] [%d] New round arrived.', result.round, result.price);
					return true;
				}
			});
		}).on('error', function (err) {
			console.log('something went wrong on the request', err.request.options);
		});
		break;
	}
}

function parseData(data) {
	try {		
		data = data.toString('utf8');
		return JSON.parse(data);
	} catch (error) {
		console.error('[DEBUG] Error when trying to parse JSON');
		return null;
	}
}