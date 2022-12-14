'use strict'
const async = require('async');
const dotenv = require('dotenv');
const AWS = require('aws-sdk');
const moment = require('moment-timezone');
const AWSRegionName = 'us-east-1';
const AWSSESRegionName = 'us-east-1';

dotenv.config({path:'./config.env'});

const ec2 = new AWS.EC2({
    region: AWSRegionName,
    apiVersion: '2020-01-20'
});
const ses = new AWS.SES({
    region: AWSSESRegionName,
    apiVersion: '2020-01-20'
});

const TagName = process.env.tagName; //Specify the tagName(Ex. 'BackupInstance').
const SENDER_EMAIL_ID = process.env.sourceEmailId; //Specify the sender email address.
const CC_EMAIL_IDS = [process.env.CCEmailId]; //Specify the cc email ids.
const TO_EMAIL_IDS = [process.env.destinationEmailId]; //Specify the recipient email ids.

/**
 * Note: Make sure the email ids have been verified from AWS SES services, else you can't send the mail on the specified email ids.
 */

/**
 * @description Specify the retention time type for the AMIs.  It can be year, quarters,months, week, days, hours, minutes, seconds, milliseconds.
 * @example RETENTION_TYPE = 'minutes'
 */
const RETENTION_TYPE = process.env.retentionType; // IF you wish year then find from the below keyword and place it.

/**
 * @description Specify the retention time for the AMIs. After how much time, the AMIs should be deleted. It is the expiry period of the AMIs.
 * @example RETENTION_TIME = '15'  //It means 15 minutes (retention_time + retention_type).
 * https://momentjs.com/docs/#/manipulating/add/
 */

const RETENTION_TIME = process.env.retentionTime;

exports.handler = (event, context, callback) => {
    var TotalOperationForEc2 = [];

    async.waterfall([
        /**
         * @param {Object} done
         * @description Fetch those ec2 instances, which have tag `BackupNode : True` and the instances are either stopped or in running state.
         * @returns Array object of ec2 instances
         */
        function (done) {
            let params = {
                Filters: [{
                    Name: 'tag:' + TagName,
                    Values: ['true', 'True']
                }, {
                    Name: 'instance-state-name',
                    Values: ['running', 'stopped']
                }]
            };
            ec2.describeInstances(params, function (err, data) {
                if (err) {
                    console.log(err, err.stack);
                    done(err, null);
                }
                else {
                    done(null, data);
                }
            });
        },
        /**
         *
         * @param {Object} instances
         * @param {Function} done
         * @description This function will count the number of ec2 instances.
         * @returns Callback function
         */

        function (instances, done) {
            console.log('Calculating number of instances...');
            if (instances && instances.Reservations.length > 0) {
                var ec2Instances = [];
                async.map(instances.Reservations, (instance, done1) => {
                    if(instance.Instances.length > 1){
                        instance.Instances.map((instanceData)=>{
                            ec2Instances.push(instanceData);
                        });
                        done1(null, [...ec2Instances]);
                    } else{
                        done1(null,instance.Instances[0]);
                    }
                }, (err, result) => {
                    if (err) {
                        done(err, null);
                    }
                    else {
                        done(null, result);
                    }
                });
            }
            else {
                done(null, 'Instances not found!');
            }
        },

        /**
         *
         * @param {Object} instances
         * @param {Function} done
         * @description This function will create AMI & Snapshot of each instances and tag them with new tag like `isExpireOn : 1567364744744`.
         * @returns Callback function
         */

         function (instances, done) {
            instances = [].concat.apply([], instances);
            console.log('Number of instances ::', instances.length);
            if (instances && instances.length > 0) {
                async.map(instances, (instance, done1) => {
                    var instanceId = instance.InstanceId;
                    console.log('Creating Image for ::', instanceId);
                    let params = {
                        InstanceId: instanceId,
                        Name: 'AMI_' + instanceId + '_' + moment.tz(new Date(), "Asia/Kolkata").add(RETENTION_TIME, RETENTION_TYPE).valueOf().toString(),
                        Description: 'This is an AMI of ' + instanceId + '. Created on : ' + new Date().getTime(),
                        NoReboot: false
                    };
                    ec2.createImage(params, function (err, data) {
                        if (err) {
                            console.log(err, err.stack);
                            done1(err, null);
                        }
                        else {
                            let Tags = [];
                            let instanceInfo = {};
                            instanceInfo['InstanceId'] = instanceId;
                            instanceInfo['ImageId'] = data.ImageId;
                            TotalOperationForEc2.push(instanceInfo);
                            let imageTags = instance.Tags;
                            imageTags.forEach(element => {
                                if (element.Key.indexOf("aws:", 0) == -1) {
                                    Tags.push(element);
                                }
                            });
                            Tags.push({
                                Key: 'isExpireOn',
                                Value: moment.tz(new Date(), "Asia/Kolkata").add(RETENTION_TIME, RETENTION_TYPE).valueOf().toString()
                            },{
                                Key: 'InstanceType',
                                Value: instance.InstanceType
                            },{
                                Key: 'KeyName',
                                Value: instance.KeyName
                            },{
                                Key: 'VpcId',
                                Value: instance.VpcId
                            },{
                                Key: 'SubnetId',
                                Value: instance.SubnetId
                            });
                            var tagparams = {
                                Resources: [data.ImageId],
                                Tags: Tags
                            };
                            ec2.createTags(tagparams, function (err, data) {
                                if (err) {
                                    console.log(err, err.stack);
                                    done1(err, null);
                                }
                                else {
                                    console.log("Tags added to the created AMIs");
                                    done1(null, data);
                                }
                            });
                        }
                    });
                }, (err, result) => {
                    if (err) {
                        done(err, null);
                    }
                    else {
                        done(null, result);
                    }
                });
            }
            else {
                done(null, 'Instances not found!');
            }
        },
        /**
         * @param {Object} forami
         * @param {Function} done
         * @description This function will fetch the AMI from the AMI list, which have tag like `BackupNode : True`.
         * @returns Callback function
         */
        function (forami, done) {
            let params = {
                Filters: [{
                    Name: 'tag:' + TagName,
                    Values: ['true', 'True']
                }],
                Owners: ['self']
            };
            ec2.describeImages(params, function (err, data) {
                if (err) {
                    console.log(err, err.stack);
                    done(err, null);
                }
                else {
                    done(null, data);
                }
            });

        },
    ], (err, result) => {
        if (err) {
            console.log('Err :: ', err);
            sendEmail('[Err] AMI automation script report!', SENDER_EMAIL_ID, TO_EMAIL_IDS, CC_EMAIL_IDS, err);
            callback(err, null);
        }
        else {
            let FinalDone = {
                "TotalOperationForEc2": TotalOperationForEc2,
            }
            let message = "Hello, Report of AMI Automation script!  \n" +
                "Ami creation result ->  " + JSON.stringify(TotalOperationForEc2) + ", \n \n " +
                "\n \n " +
                "Thanks";
            sendEmail("AMI automation script report!", SENDER_EMAIL_ID, TO_EMAIL_IDS, CC_EMAIL_IDS, message);
            callback(null, FinalDone);
        }
    });

};

/**
 * @param {String} subject
 * @param {String} senderId
 * @param {Array} to
 * @param {Array} Cc
 * @param {String} messageContent
 * @description This function will send a report of the script as an email.
 */
var sendEmail = function (subject, senderId, to, Cc, messageContent) {

    ses.sendEmail({
        Source: senderId,
        Destination: {
            BccAddresses: [],
            CcAddresses: Cc,
            ToAddresses: to
        },
        Message: {
            Subject: {
                Data: subject
            },
            Body: {
                Text: {
                    Charset: "UTF-8",
                    Data: messageContent
                }
            }
        }
    }, function (err) {
        if (err) {
            console.log(err);
            throw err;
        }
        else {
            console.log('Email has been sent!');
        }
    });
};

