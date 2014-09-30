/*jslint node: true */
/*global log, debug, Future, Utils, ActivityHelper, PalmCall */

var CheckUpdateAssistant = function () {
    "use strict";
};

CheckUpdateAssistant.prototype.parseManifest = function (manifest, deviceName, ignorePlatformVersion, changes, localVersion) {
    var platformVersion = manifest.platformVersion,
        maxVersion = localVersion || -1;

    manifest.changeLog.forEach(function getMaxVersion(entry) {
        if (!ignorePlatformVersion && entry.version > platformVersion) {
            return;
        }

        if (entry.unsupported_devices) {
            var found = false;
            entry.unsupported_devices.forEach(function checkIgnored(device) {
                if (device === deviceName) {
                    found = true;
                }
            });

            if (found) {
                log("Ignoring version " + entry.version + " for device " + deviceName);
                return;
            }
        }

        if (entry.version > maxVersion) {
            maxVersion = entry.version;
            changes.push(entry);
        }
    });

    //sort changes since last update:
    changes.sort(function sortFunction(a, b) {
        return b.version - a.version;
    });

    log("Read maximum version: " + maxVersion, " from manifest " + JSON.stringify(manifest));
    return maxVersion;
};

CheckUpdateAssistant.prototype.run = function (outerFuture) {
    "use strict";
    var future = new Future(), args = this.controller.args, localVersion, remoteVersion, manifest, ignorePlatformVersion = false, deviceName, changesSinceLast = [];

    function handleError(msg, error) {
        if (!error) {
            error = {};
        }
        log(msg + ": " + JSON.stringify(error));
        var message = msg;
        if (typeof error === "string") {
            msg += " - " + error;
        } else if (error.message) {
            msg += " - " + error.message;
        }
        outerFuture.result = { returnValue: false, success: false, needUpdate: false, message: msg};
    }

    future.nest(PalmCall.call("palm://com.palm.connectionmanager", "getStatus", {subscribe: false}));

    future.then(function getStatusCB() {
        var result = Utils.checkResult(future);
        log("Connection status: " + JSON.stringify(result));
        if (result.returnValue && result.isInternetConnectionAvailable) {
            future.nest(PalmCall.call("palm://com.palm.systemservice/", "getPreferences", {
                keys: ["updateIgnorePlatformVersion"]
            }));

        } else {
            handleError("No internet connection.");
        }
    });

    future.then(this, function getPrefCallback() {
        var result = Utils.checkResult(future);
        if (result.returnValue) {
            ignorePlatformVersion = result.updateIgnorePlatformVersion;
            if (ignorePlatformVersion) {
                log("Configured to get latest cutting edge version.");
            } else {
                log("Using manifest version.");
            }
        } else {
            log("Could not get pref, continue with default value");
        }
        future.nest(Utils.getLocalPlatformVersion());
    });

    future.then(this, function localVersionCallback() {
        var result = Utils.checkResult(future);
        log("localVersion came back: " + JSON.stringify(result));
        if (result.returnValue === true) {
            if (result.buildTree !== "stable") {
                handleError("No update possible on " + result.buildTree + " build tree.");
            } else {
                localVersion = result.version;
                log("Have localVersion: " + localVersion);
                future.nest(Utils.getDeviceName());
            }
        } else {
            log("localVersion came back WITH ERROR: " + JSON.stringify(result));
            handleError("Could not get local plattform version.", result.exception);
        }
    });

    future.then(this, function deviceNameCB() {
        var result = Utils.checkResult(future);
        if (result.returnValue === true) {
            deviceName = result.device_name;
            future.nest(Utils.getManifest());
        } else {
            handleError("Could not get device name", future.exception);
        }
    });

    future.then(this, function manifestCallback() {
        var result = Utils.checkResult(future);
        if (result && result.returnValue === true) {
            manifest = result.manifest;
            remoteVersion = this.parseManifest(manifest,
                                               deviceName,
                                               ignorePlatformVersion,
                                               changesSinceLast,
                                               localVersion);

            if (!remoteVersion) {
                handleError("Could not parse remote version from manifest", {message: JSON.stringify(manifest)});
                return;
            }

            //potentially write update-to-version file.
            future.nest(Utils.handleUpdateFiles(remoteVersion, manifest));
        } else {
            handleError("Could not get manifest", future.exception);
        }
    });

    future.then(function handleUpdateFilesCallback() {
        var result = Utils.checkResult(future), newResult;
        if (result.returnValue) {
            log("Remote version came back: " + remoteVersion);
            if (remoteVersion > localVersion) {
                newResult = {
                    returnValue: true,
                    success: true,
                    needUpdate: true,
                    changesSinceLast: changesSinceLast
                };

                //notify user that we have an update
                //first close all old notifications, then create a new one.
                PalmCall.call("palm://org.webosports.notifications", "closeAllNotifications", {}).then(function () {
                    PalmCall.call("palm://org.webosports.notifications", "createNotification", {
                        launchId: "org.webosports.app.settings",
                        launchParams: {page: "SystemUpdates", needUpdate: true, changesSinceLast: changesSinceLast },
                        title: "System update available",
                        message: "New version " + remoteVersion
                    }).then(function appManagerCallback(f) {
                        log("ApplicationManager call came back: " + JSON.stringify(f.result));
                    });
                });

                outerFuture.result = newResult;
            } else {
                //no update necessary.
                outerFuture.result = { returnValue: true, success: true, needUpdate: false};
            }
        } else {
            handleError("Something went wrong in the filesystem.", result.message);
        }
    });

    return outerFuture;
};

CheckUpdateAssistant.prototype.complete = function (activity) {
    "use strict";
    return ActivityHelper.restartActivity(activity);
};

module.exports = CheckUpdateAssistant;
