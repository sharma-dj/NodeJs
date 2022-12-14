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

const TagName = 'BackupInstance'; //process.env.tagName; //Specify the tagName(Ex. 'BackupInstance').
const SENDER_EMAIL_ID = process.env.sourceEmailId; //Specify the sender email address.
const CC_EMAIL_IDS = [process.env.CCEmailId]; //Specify the cc email ids.
const TO_EMAIL_IDS = [process.env.destinationEmailId]; //Specify the recipient email ids.

/**
 * Note: Make sure the email ids have been verified from AWS SES services, else you can't send the mail on the specified email ids.
 */


exports.handler = (event, context, callback) => {
    var TotalOperationForEc2 = [], TotalOperationForAMIDelete = [];

    async.waterfall([
        /**
         * @param {Object} done
         * @description Fetch those ami, which have tag `BackupInstance : True`.
         * @returns Array object of amis
         */
        function (done) {
            let params = {
                Filters: [{
                    Name: 'tag:' + TagName,
                    Values: ['true', 'True']
                }]
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
        /**
         *
         * @param {Object} images
         * @param {Function} done
         * @description This function will count the number of amis.
         * @returns Callback function
         */
        function (images, done) {
            console.log('Calculating number of ami...');
             if (images && images.Images.length > 0) {
                var ec2Images = [];
                async.map(images, (image, done1) => {
                    if(images.Images.length > 1){
                        images.Images.map((imageData)=>{
                            ec2Images.push(imageData);
                        });
                        done1(null, [...ec2Images]);
                    } else{
                        done1(null,images.Images[0]);
                    }
                }, (err, result) => {
                    if (err) {
                        done(err, null);
                    }
                    else {
                        done(null, result);
                    }
                 });
              }else {
                  console.log("here");
                  done(null, 'Images not found!');
              }
        },
        /**
         *
         * @param {Object} images
         * @param {Function} done
         * @description This function will create instance of each images and tag them with new tag like `backupinstance : true`.
         * @returns Callback function
         */
        function (images, done) {
            images = [].concat.apply([], images);
            console.log('Number of instances ::', images.length);
            if (images && images.length > 0) {
              //  console.log(images);

                async.map(images, (image, done1) => {
                    let Tags = [];
                   // let keyName = instancetype = nbackupInstances  = '';
                   let ckeyname='';
                   let bkinstance='';
                   let aminame='';
                   let instype='';
                   let vpcid='';
                   let subnetid='';
                    let imageTags = image.Tags;
                 //    console.log(imageTags);
                    imageTags.filter(function (obj) {
                        if(obj.Key=='KeyName'){
                            ckeyname = obj.Value;
                        }
                        if(obj.Key=='InstanceType'){
                            instype = obj.Value;
                        }
                        if(obj.Key=='BackupInstance'){
                            bkinstance = obj.Value;
                        }
                        if(obj.Key=='Name'){
                            aminame = obj.Value;
                        }
                        if(obj.Key=='VpcId'){
                            vpcid = obj.Value;
                        }
                        if(obj.Key=='SubnetId'){
                            subnetid = obj.Value;
                        }

                     });
                     var userData= `#!/bin/bash
sudo apt-get update
sudo apt-get upgrade -y
touch /var/www/html/hello.txt
cd /var/www/html
wp core update
`;

var init_script = new Buffer(userData).toString('base64');
                    let params = {
                        ImageId: image.ImageId,
                        InstanceType: instype,
                        KeyName: ckeyname,
                        SubnetId: subnetid,
                        MinCount: 1,
                        MaxCount: 1,
                        UserData:init_script
                    };
                    console.log(params);
                    ec2.runInstances(params, function (err, data) {
                        if (err) {
                            console.log(err, err.stack);
                            done1(err, null);
                        }
                        else {
                            //let Tags = [];
                            let instanceInfo = {};
                            let instnace = data.Instances;
                            console.log(instnace[0].KeyName);
                            console.log(instnace[0].VpcId);
                            console.log(instnace[0].SubnetId);

                            instanceInfo['InstanceId'] = instnace[0].InstanceId;
                            instanceInfo['ImageId'] = instnace[0].ImageId;
                            TotalOperationForEc2.push(instanceInfo);
                            Tags.push({
                                Key: 'Name',
                                Value: aminame+'-'+moment.tz(new Date(), "Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss")
                            },{
                                Key: 'BackupInstance',
                                Value: 'True'
                            });
                            var tagparams = {
                                Resources: [instnace[0].InstanceId],
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
                       let imgtags = [];
                    imgtags.push({
                                Key: 'BackupInstance',
                                Value: 'False'
                            },{
                                 Key: 'Isdelete',
                                Value: '1'
                            });
                    var imgtagparams = {
                                Resources: [image.ImageId],
                                Tags: imgtags
                            };
                    ec2.createTags(imgtagparams, function (err, data) {
                        if (err) {
                            console.log(err, err.stack);
                        }
                        else {
                            console.log("Tags added & updated to the AMIs");
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
            };
            console.log("Instances has been created for the following AMIs ::", TotalOperationForEc2);
            let message = "Hello, Report of AMI Automation script!  \n" +
                "Instance creation result ->  " + JSON.stringify(TotalOperationForEc2) + ", \n \n " +
                "\n \n " +
                "Thanks";
            sendEmail("Create instance from ami automation script report!", SENDER_EMAIL_ID, TO_EMAIL_IDS, CC_EMAIL_IDS, message);
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

