/*jslint node: true */
/*global log, fs, debug, Future, Utils, ActivityHelper, Config, Parser */

var DownloadUpdateAssistant = function () {
	"use strict";
};

DownloadUpdateAssistant.prototype.run = function (outerFuture, subscription) {
	"use strict";
	var future = new Future(),
		numDownloaded = 0, toDownload = 0, doneUpdating = false, doneGetNumPackages = false;
		
	//send status to application... 
	function logToApp(numNew) {
		numDownloaded += numNew;
		var f, status = { numDownloaded: numDownloaded, toDownload: toDownload };
		if (subscription) {
			f = subscription.get();
			f.result = status;
		} else {
			log("Don't have subscription... Would have sended: " + JSON.stringify(status));
		}
	}
	
	//send errors to application:
	function handleError(msg, error) {
		var outMsg = msg + ": " + (error.message || error.msg) + (error.code ? (", code: " + error.code) : "");
		log(msg + ": " + JSON.stringify(error));
		outerFuture.result = { returnValue: false, success: false, error: true, msg: outMsg};
	}
		
	//handles child process output and termination:
	function childCallback() {
		try {
			var result = future.result;
			if (result.finished && result.error === false) {
				if (doneGetNumPackages) {
					log("Download Log:\n" + Parser.getDownloadLog());
					//we are done:
					outerFuture.result = {success: true, finished: true, error: false, msg: "Done downloading."};
				} else if (doneUpdating) {
					doneGetNumPackages = true;
					toDownload = Parser.getNumPackages();
					log("Get num packages: " + toDownload);
					future.nest(Utils.spawnChild(Config.downloadCommand, Parser.parseDownloadOutput.bind({}, logToApp)));
					future.then(childCallback);
				} else {
					//package feed update finished. Go on.
					doneUpdating = true;
					log("Update Log:\n" + Parser.getUpdateLog());
					future.nest(Utils.spawnChild(Config.numPackagesCommand, Parser.parseNumPackages));
					future.then(childCallback);
				}
			} else {
				throw ({message: "Child did finish with error", errorCode: result.code});
			}
		} catch (e) {
			handleError("Error during " + (doneUpdating ? "downloading packages" : "updating feeds"), e);
		}
	}
	
	Parser.clear();
	
	future.nest(Utils.checkDirectory(Config.downloadPath));
	
	future.then(function pathCB() {
		try {
			var result = future.result;
			if (result.returnValue) {
				future.nest(Utils.spawnChild(Config.preDownloadCommand, Parser.parseUpdateOutput));
			} else {
				throw {message: "Unknown error: " + JSON.stringify(result)};
			}
		} catch (e) {
			handleError("Error during checking/creating download directory", e);
		}
	});
	
	future.then(childCallback);
	
	return outerFuture;
};

