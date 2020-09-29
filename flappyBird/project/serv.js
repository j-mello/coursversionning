let http = require('http'),
	url = require('url'),
	fs = require('fs');

const Party = require("./Party.class"),
	Player = require("./Player.class"),
	Helpers = require("./Helpers.class");

let players = {};
let parties = [];

const extension_per_mime = {
	"text/css": ["css"],
	"text/html": ["html","htm"],
	"text/javascript": ["js"],
	"image/{ext}": ["png", "gif", "bmp", "tif", "tiff", "ico"],
	"image/jpeg": ["jpg", "jpeg"]
};

let mime_per_extension = {};

for (let mime in extension_per_mime) {
	const extensions = extension_per_mime[mime];
	for (let i=0;i<extensions.length;i++) {
		mime_per_extension[extensions[i]] = mime.replace("{ext}", extensions[i]);
	}
}

const forbidden_path = ["node_modules"];

const forbidden_extentions = ["js","json","gitignore"];

const authorized_files = ["socket.io.js","client.js"];


const config = require("./config");

const server = http.createServer(function(req, res) { // --------------------------> LE SERVEUR HTTP <------------------------------------------------------
	let page = url.parse(req.url).pathname;
	const param = url.parse(req.url).query;
	if (page == "/") {
		page = "/index.html"
	} else if (page == "/socket.io/") {
		page = "/socket.io/socket.io.js"
	}
	page = __dirname + page;
	let authorized = true;

	const ext = page.split(".")[page.split(".").length-1];
	const filename = page.split("/")[page.split("/").length-1];

	for (let i=0;i<forbidden_path.length;i++) {
		if (
			page.length >= forbidden_path[i].length &&
			page.substring(0,forbidden_path[i].length) === forbidden_path[i]
		) {
			authorized = false;
			break;
		}
	}

	if (authorized) {

		for (let i = 0; i < forbidden_extentions.length; i++) {
			if (ext === forbidden_extentions[i]) {
				authorized = false;
				break;
			}
		}
		if (!authorized) {
			for (let i = 0; i < authorized_files.length; i++) {
				if (filename === authorized_files[i]) {
					authorized = true;
					break;
				}
			}
		}
	}
	if (authorized) {
		fs.readFile(page, function (error, content) {
			if (error) {
				res.writeHead(404, {"Content-Type": "text/plain"});
				res.end("ERROR 404 : Page not found");
			} else {
				res.writeHead(200, {
					"Content-Type": typeof (mime_per_extension[ext]) != "undefined" ? mime_per_extension[ext] : "text/plain"
				});
				res.end(content);
			}
		});
	} else {
		res.writeHead(403, {"Content-Type": "text/plain"});
		res.end("ERROR 403 : Access Forbidden");
	}
});

const io = require('socket.io').listen(server);

io.sockets.on('connection', function (socket) {

	socket.on("login", function (pseudo) {
		if (typeof(socket.player) != "undefined") {
			return;
		}
		if (pseudo === "") {
			pseudo = "user"+Helpers.rand(10**3,10**4);
			while (typeof(players[pseudo]) != "undefined") {
				pseudo = "user"+Helpers.rand(10**3,10**4);
			}
		}
		let nb = "";
		while (typeof(players[pseudo+nb]) != "undefined") {
			if (nb === "") {
				nb = 2;
			} else {
				nb += 1;
			}
		}
		let player = new Player(socket);
		player.setPseudo(pseudo+nb);
		players[pseudo+nb] = player;
		socket.player = player;
		socket.emit("login_successfull", config);
		socket.emit("remove_msgs");
	});

	socket.on('disconnect',function(){
		if (typeof(socket.player) != "undefined") {
			if (socket.player.party != null) {
				quitParty(socket);
			}
			delete players[socket.player.pseudo];
		}
	});

	socket.on("quit_party", function () {
		if (typeof(socket.player) != "undefined" && socket.player.party != null) {
			quitParty(socket);
			socket.emit("remove_msgs");
		}
	});

	socket.on("create_party", function () {
		if (typeof(socket.player) == "undefined" || socket.player.party != null) {
			return;
		}
		let party = new Party(socket.player);
		parties.push(party);
		socket.player.party = party;
		socket.emit("display_party_players", {admin: socket.player.pseudo, players: []});
		displayAllParties(socket.broadcast);
		socket.emit("remove_msgs");
	});

	socket.on("get_parties", function () {
		if (typeof(socket.player) == "undefined" || socket.player.party != null) {
			return;
		}
		displayAllParties(socket);
		socket.emit("remove_msgs");
	});

	socket.on("join_party", function (adminPseudo) {
		if (typeof(socket.player) == "undefined" || socket.player.party != null) {
			return;
		}
		if (typeof(players[adminPseudo]) == "undefined") {
			socket.emit("display_msgs", {type: "error", msgs: "L'utilisateur "+adminPseudo+" ne semble pas exister"});
			return;
		}
		if (players[adminPseudo].party == null) {
			socket.emit("display_msgs", {type: "error", msgs: "L'utilisateur "+adminPseudo+" ne semble pas avoir créé de partie"});
			return;
		}
		if (players[adminPseudo].party.started) {
			socket.emit("display_msgs", {type: "error", msgs: "La partie est déjà en cours"});
			return;
		}
		if (players[adminPseudo].party.players.length+1 === config.maxPlayerByParty) {
			socket.emit("display_msgs", {type: "error", msgs: "Le nombre de joeurs pour cette partie est déjà atteint"});
			return;
		}

		let party = players[adminPseudo].party;
		party.addPlayer(socket.player);
		let party_players = party.getPseudoList();
		socket.player.party = party;
		party.broadcastSomethings((player) => {
			player.socket.emit("display_party_players", {admin: party.admin.pseudo, players: party_players});
		});
		displayAllParties(socket.broadcast);
		socket.emit("remove_msgs");
		socket.emit("party_joined");
	});

	socket.on("want_restart_party", function () {
		if (typeof(socket.player) == "undefined" || socket.player.party == null) {
			socket.emit("display_msgs", {type: "error", msgs: "Vous n'êtes dans aucune partie où vous n'êtes même pas connecté"});
			return;
		}
		let player = socket.player;
		let party = player.party;
		if (!party.finished) {
			socket.emit("display_msgs", {type: "error", msgs: "Cette partie n'est pas encore terminée"});
			return;
		}

		if (party.admin.pseudo === player.pseudo) {
			socket.emit("display_msgs", {type: "error", msgs: "En tant qu'admin vous devez soit rester dans la partie soit y mettre fin"});
			return;
		}

		if (player.wantToRestart) {
			socket.emit("display_msgs", {type: "error", msgs: "Vous avez déjà choisis de recommencer"});
			return;
		}

		player.wantToRestart = true;

		socket.emit("hide_want_to_restart_button");
	});

	socket.on("start_party", function () {
		if (typeof(socket.player) != "undefined" && socket.player.party != null) {
			let party = socket.player.party;
			if (party.admin.pseudo !== socket.player.pseudo) {
				socket.emit("display_msgs", {type: "error", msgs: "Vous n'êtes pas l'admin de cette partie"});
				return;
			}
			if (party.started) {
				socket.emit("display_msgs", {type: "error", msgs: "Votre partie est déjà en cours"});
				return;
			}
			if (party.players.length === 0) {
				socket.emit("display_msgs", {type: "error", msgs: "Vous êtes encore seul dans cette partie"});
				return;
			}
			party.startParty();
		}
	});

	socket.on("single_party", function () {
		if (typeof(socket.player) == "undefined" || socket.player.party != null) {
			return;
		}
		socket.emit("start_party");
		let player = socket.player;
		let party = new Party(player);
		party.canPlay = true;
		party.started = true;
		parties.push(party);
		player.setParty(party);
		socket.emit("display_life", socket.player.life);
		party.spawnEntitie(config.width/5,config.height/2,"player",1, {
			player: player,
			color: (player.pseudo !== player.party.admin.pseudo) ? Helpers.generateVariantColorFromBase(config.baseColorOfPlayer) : "#ffff00",
			toExecuteWhenStopped: (entity) => {
				party.releaseBird(entity.player)
			}
		});
		party.writeBorder();
		socket.player.setEntity(party.entities[1]);
		party.entities[1].player = socket.player;
		socket.emit("remove_msgs");
	});

	socket.on("fly_bird", function () {
		if (typeof(socket.player) == "undefined" || socket.player.party == null) {
			return;
		}
		socket.player.party.flyBird(socket.player);
	});
});

function removeParty(party) {
	for (let i=0;i<parties.length;i++) {
		if (party.admin.pseudo === parties[i].admin.pseudo) {
			parties.splice(i,1);
			return true;
		}
	}
	return false;
}

function displayAllParties(socket) {
	let partyList = [];
	for (let i=0;i<parties.length;i++) {
		if (!parties[i].started) {
			partyList.push({admin: parties[i].admin.pseudo, nbPlayers: parties[i].players.length+1});
		}
	}
	socket.emit("display_parties", partyList);
}

function quitParty(socket) {
	if (socket.player.pseudo === socket.player.party.admin.pseudo) {
		removeParty(socket.player.party);
	}
	socket.player.party.stopParty(socket.player);

	displayAllParties(socket.broadcast);
}

server.listen(3005);
