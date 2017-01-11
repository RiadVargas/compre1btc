var client 		= require('node-rest-client').Client,
	client 		= new client(),
    math   		= require('mathjs'),
    cache 		= require('node-cache'),
	priceCache 	= new cache();

module.exports = {
	retrieveData: function(socket) {
		var obj, url, result, round;
		url = "https://s3.amazonaws.com/data-production-walltime-info/production/dynamic/meta.json?now="+Date.now(); // Generates an URL to retrieve metadata from API, using current timestamp to avoid cache
		client.get(url, function (data, response) { // Makes the request using the generated URL
			obj = module.exports.parseData(data); // Parses the recieved data in JSON format
			priceCache.get('buy', function(err, value) { // Try to load the cache
				if(err || !value) {
					console.log('[DEBUG] Error while trying to get cache, assuming it\'s empty.'); // Error when trying to locate or empty value, let's assume it's empty and
					return module.exports.updatePrices(obj, socket); // Request the new round
				}
				if(value.round == obj.current_round) return false; // The round at API's server is the same cached, let's save some bandwidth
				return module.exports.updatePrices(obj, socket); // Request the new round
			});
		}).on('error', function (err) {
			console.log('[DEBUG] Something happened ...', err.request.options); // Handles with error and console it
		});
	},
	updatePrices: function(obj, socket) {
		module.exports.updateBuyPrice(obj, socket); // Call the function which gets the current price for buy 1BTC
		module.exports.updateSellPrice(obj, socket); // Call the function which gets the current price for sell 1BTC
	},
	updateBuyPrice: function(response, io) {
		var obj, url, result, amount = 1, total, diff;
		for (var i = 0; i <= response.order_book_pages - 1; i++) { // Iterates with every order book page until get wanted amount filled
			url     = "https://s3.amazonaws.com/data-production-walltime-info/production/dynamic/"+response.order_book_prefix+"_r"+response.current_round+"_p"+i+".json"; // Generates an URL to get data from the current round and page (i)
			client.get(url, function (data) { // Makes the request using the generated URL
				obj = module.exports.parseData(data); // Parses the recieved data in JSON format
				if(obj == null) { // If the response JSON is empty, try to retrieve again
					module.exports.retrieveData();
					return console.error('[DEBUG] JSON data empty, retrying ...');
				}
				obj['xbt-brl'].some(function(value) { // Iterates with every order in the current page until get the wanted amount filled
					value[0] = math.eval(value[0]); // Calculates the expression given by API to get the quantity
					value[1] = math.eval(value[1]); // Calculates the expression given by API to get the total value
					if(value[0] >= amount) { // If quantity is equal or bigger than the needed amount
						total     = math.sum(total, math.multiply(math.divide(value[1], value[0]), amount)); // Sum current total and the part (quantity) of total value from the current order
						amount    = 0; // We don't need more bitcoins
					}
					else { // Else
						amount    = math.subtract(amount, value[0]); // Subtract from the needed amount the current order quantity
						total     = math.sum(total, value[1]); // Sum the our total with the order total
					}
					if(amount == 0) { // If we don't need more bitcoins
						result     = { 
							price: total, // Total spent to buy 1BTC
							timestamp: obj.timestamp, // Current round timestamp
							round: response.current_round // Current round UID
						};
						priceCache.set('buy', result); // Cache all the informations we got
						io.sockets.emit('update', result); // Broadcast an update to all connected socket.io users
						console.log('[DEBUG] [BUY] [R%d] [%d] New round arrived.', result.round, result.price);
						return true;
					}
				});
			}).on('error', function (err) {
				console.log('[DEBUG] Something happened ...', err.request.options); // Handles with error and console it
			});
			break;
		}
	},
	updateSellPrice: function(response, io) {
		var obj, url, result, amount = 1, total, diff;
		for (var i = 0; i <= response.order_book_pages - 1; i++) { // Iterates with every order book page until get the BTC solded
			url     = "https://s3.amazonaws.com/data-production-walltime-info/production/dynamic/"+response.order_book_prefix+"_r"+response.current_round+"_p"+i+".json"; // Generates an URL to get data from the current round and page (i)
			client.get(url, function (data) { // Makes the request using the generated URL
				obj = module.exports.parseData(data); // Parses the recieved data in JSON format
				if(obj == null) { // If the response JSON is empty, try to retrieve again
					module.exports.retrieveData();
					return console.error('[DEBUG] JSON data empty, retrying ...');
				}			
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
					if(amount == 0) { // If we already solded a full BTC
						result     = { 
							price: total, // Total spent to buy 1BTC
							timestamp: obj.timestamp, // Current round timestamp
							round: response.current_round // Current round UID
						};
						priceCache.set('sell', result); // Cache all the informations we got
						io.sockets.emit('sell', result); // Broadcast an update to all connected socket.io users
						console.log('[DEBUG] [SELL] [R%d] [%d] New round arrived.', result.round, result.price);
						return true;
					}
				});
			}).on('error', function (err) {
				console.log('[DEBUG] Something happened ...', err.request.options); // Handles with error and console it
			});
			break;
		}
	},
	emitCache: function(socket) {
		priceCache.get('buy', function(err, value) { // Retrieves our buy price cache
			socket.emit('buy', value); // Sends to the socket
		});
		priceCache.get('sell', function(err, value) { // Retrieves our sell price cache
			socket.emit('sell', value); // Sends to the socket
		});
	},
	parseData: function(data) {
		try {
			data = data.toString('utf8');
			return JSON.parse(data);
		} catch (error) {
			console.error('[DEBUG] Error when trying to parse JSON');
			return null;
		}
	}
};