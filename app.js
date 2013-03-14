/*
 * voterunner - quick and dirty votes and discussions
 *
 * copyright: 2013 Tobias Bengfort <tobias.bengfort@gmx.net>
 * license: AGPL-3+
 * url: http://voterunner.herokuapp.com/
 */

var express = require('express')
  , app = express.createServer()
  , io = require('socket.io').listen(app)
  , pg = require('pg')
  , fs = require('fs')
  , log = io.log // nicer log
  , conString = process.env.DATABASE_URL
  , port = process.env.PORT || 5000;

app.listen(port, function() {
	log.info("Listening on " + port);
});
app.use(express.static('static'));

// helpers
function query(sql, params, fn) {
	pg.connect(conString, function(err, db) {
		if (err) {
			log.warn("error on db connect", err.toString());
		} else {
			db.query(sql, params, function(err, result) {
				if (err) {
					log.warn("db error:", err.toString());
				} else {
					if (fn) fn(result.rows);
				}
			});
		}
	});
}

function tpl(file, data, res) {
	// embed `data` as json in a template
	fs.readFile('tpl/'+file, 'utf8', function(err, html) {
		html = html.replace(/<% ([^>]*) %>/g, function(match, key) {
			if (data.hasOwnProperty(key)) {
				return '<data id="json-' + key + '">' + JSON.stringify(data[key]) + '</data>';
			} else {
				return '';
			}
		});
		res.send(html);
	});
}

function markdown(file, res) {
	fs.readFile(file, 'utf8', function(err, markdown) {
		tpl('markdown.html', {'markdown': markdown}, res);
	});
}

// setup tables
query("CREATE TABLE IF NOT EXISTS nodes (topic TEXT, id TEXT, name TEXT, comment TEXT, delegate TEXT, UNIQUE (topic, id))");
query("CREATE TABLE IF NOT EXISTS chat (topic TEXT, id TEXT, text TEXT, t INTEGER)");

// welcome view
app.get('/', function (req, res) {
	markdown('README.md', res);
});

// app view
app.get('/:topic/', function (req, res) {
	var topic = req.params.topic;

	var sql = 'SELECT id, name, comment, delegate FROM nodes WHERE topic = $1';
	query(sql, [topic], function(nodes) {
		var sql = 'SELECT id, text, t FROM chat WHERE topic = $1 ORDER BY t ASC';
		query(sql, [topic], function(chat) {
			tpl('app.html', {'nodes': nodes, 'chat': chat}, res);
		});
	});
});

// socket.io
io.sockets.on('connection', function (socket) {
	socket.on('register', function(topic, id) {
		log.debug("Registration:", topic, id);

		socket.set('topic', topic);
		socket.set('id', id);

		socket.join(topic);
	});

	function handleMsg(action, sql, v1, v2) {
		socket.get('topic', function(err, topic) {
			socket.get('id', function(err, id) {
				log.debug("Handeling:", action, topic, id, v1, v2);

				socket.broadcast.to(topic).emit(action, id, v1, v2);

				var params = [topic, id];
				var n = sql.match(/\$/g).length;
				if (n >= 3) params.push(v1);
				if (n >= 4) params.push(v2);

				query(sql, params);
			});
		});
	}

	socket.on('createNode', function() {
		var sql = "INSERT INTO nodes (topic, id) VALUES ($1, $2)";
		handleMsg('createNode', sql);
	});
	socket.on('rmNode', function() {
		var sql = "DELETE FROM nodes WHERE topic = $1 AND id = $2";
		handleMsg('rmNode', sql);
	});
	socket.on('setNodeName', function(name) {
		var sql = "UPDATE nodes SET name = $3 WHERE topic = $1 AND id = $2";
		handleMsg('setNodeName', sql, name);
	});
	socket.on('setNodeComment', function(comment) {
		var sql = "UPDATE nodes SET comment = $3 WHERE topic = $1 AND id = $2";
		handleMsg('setNodeComment', sql, comment);
	});
	socket.on('setDelegate', function(delegate) {
		var sql = "UPDATE nodes SET delegate = $3 WHERE topic = $1 AND id = $2";
		handleMsg('setDelegate', sql, delegate);
	});
	socket.on('rmDelegate', function() {
		var sql = "UPDATE nodes SET delegate = null WHERE topic = $1 AND id = $2";
		handleMsg('rmDelegate', sql);
	});
	socket.on('chat', function(text, t) {
		var sql = "INSERT INTO chat (topic, id, text, t) VALUES ($1, $2, $3, $4)";
		handleMsg('chat', sql, text, t);
	});
});
