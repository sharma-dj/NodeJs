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
 //var timestamp = '1579866264124';

// var currentTimestamp = moment.tz(timestamp, "Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss")
// var timestamp = 1579781090303;
// const formatted = moment(timestamp).format("YYYY-MM-DD HH:mm:ss")
//
// console.log(formatted); // "02/24/2018"
exports.handler = (event, context, callback) => {
    var TotalOperationForAMIDelete = [];

    async.waterfall([

        /**
         * @param {Object} done
         * @description This function will fetch the AMI from the AMI list, which have tag like `BackupNode : True`.
         * @returns Callback function
         */
        function (done) {
            let params = {
                Filters: [{
                    Name: 'tag:' + TagName,
                    Values: ['false', 'False']
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
       * @param {Array} images
       * @param {Function} done
       * @description This function will fetch the total AMIs from your account which have tag and deregister the AMIs, if current time > retention time.
       *  It will also delete the snapshots, which are attached with the AMIs.
       */
      function (images, done) {
          console.log('Fetching total AMI from your account(only owned by you)...');
          console.log('Total AMIs :', images.Images.length);
          console.log(images.Images);
           async.map(images.Images, (image, done1) => {
               if (image) {
                   var imageName = image.Name;
                   var ExpireTimestamp = imageName.replace(/_/g, " ").split(" ");
                   var currentTimestamp = moment.tz(new Date(), "Asia/Kolkata").valueOf();
                  if (ExpireTimestamp[2] < currentTimestamp) {
                      var imageDelete = {};
                      imageDelete['ImageId'] = image.ImageId;
                      TotalOperationForAMIDelete.push(imageDelete);
                      //delete image
                      ec2.deregisterImage(imageDelete, function (err, data01) {
                          if (err) console.log(err, err.stack); // an error occurred
                          else {
                              console.log('Image id ' + image.ImageId + ' Deregistered');
                              async.map(image.BlockDeviceMappings, (snapShot, done2) => {
                                  if (snapShot.Ebs) {
                                      var snapparams = {
                                          SnapshotId: snapShot.Ebs.SnapshotId
                                      };
                                      ec2.deleteSnapshot(snapparams, function (err, data) {
                                          if (err) { console.log(err, err.stack); } // an error occurred
                                          else {
                                              console.log('Snapshot id' + snapShot.Ebs.SnapshotId + ' Deleted');
                                              done2(null, snapShot.Ebs.SnapshotId);
                                          } // successful response
                                      });
                                  } else {
                                      done2(null, null);
                                  }

                              }, (err, result) => {
                                  if (err) {
                                      console.log(err, err.stack);
                                      done1(err, null);
                                  }
                                  else {
                                      done1(null, result);
                                  }
                              });
                          }
                      });
                  }
                  else {
                      done1(null, null);
                  }
               }
               else {
                   console.log('Not found any AMI!');
                   done1(null, null);
               }
           }, (err, result) => {
               if (err) {
                   console.log(err, err.stack);
                   done(err, null);
               }
               else {
                   done(null, result);
               }
           });
      }
    ], (err, result) => {
      if (err) {
          console.log('Err :: ', err);
          sendEmail('[Err] AMI automation script report!', SENDER_EMAIL_ID, TO_EMAIL_IDS, CC_EMAIL_IDS, err);
          callback(err, null);
      }
      else {
          let FinalDone = {
              "TotalOperationForAMIDelete": TotalOperationForAMIDelete,
          }
          console.log("AMI has been deleted for the following instances ::", TotalOperationForAMIDelete);
          let message = "Hello, Report of AMI Automation script!  \n" +
              "Ami delete result ->  " + JSON.stringify(TotalOperationForAMIDelete) + ", \n \n " +
              "\n \n " +
              "Thanks";
          sendEmail("AMI deletion automation script report!", SENDER_EMAIL_ID, TO_EMAIL_IDS, CC_EMAIL_IDS, message);
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

