'use strict'
const AWS = require("aws-sdk");
const async = require('async');
const dotenv = require('dotenv');
const moment = require('moment-timezone');
const AWSRegionName = 'us-east-2';
const AWSSESRegionName = 'us-east-2';

dotenv.config({path:'./config.env'});

const ec2 = new AWS.EC2({
  region: AWSRegionName
});
const autoscaling = new AWS.AutoScaling({
  region: AWSRegionName
});
const ses = new AWS.SES({
  region: AWSSESRegionName,
  apiVersion: '2020-01-20'
});

const TAG_NAME = process.env.tagName; //Specify the tagName(Ex. 'dev.diegosechi').
const ASG_NAME = process.env.asgName; //Specify the asgName(Ex. 'diegosechi-asg').
const INSTANCE_TYPE = process.env.instanceType; //Specify the instanceType(Ex. 't2.medium').
const KEY_NAME = process.env.keyName; //Specify the keyName(Ex. 'diegosechi-key-pair').
const SECURITY_GROUP = process.env.securityGroup; //Specify the securityGroup(Ex. 'sg-053ad5c16286eb2cc').
const LC_PREFIX = process.env.launchConfiguration; //Specify the launchConfiguration(Ex. 'diegosechi-alc').
const SENDER_EMAIL_ID = process.env.sourceEmailId; //Specify the sender email address.
const CC_EMAIL_IDS = [process.env.CCEmailId]; //Specify the cc email ids.
const TO_EMAIL_IDS = [process.env.destinationEmailId]; //Specify the recipient email ids.

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
  var TotalOperationForASG = [];

  async.waterfall([
    /**
     * @param {Object} done
     * @description Fetch those ec2 instances, which have tag `Name : TagNameValue` and the instances are either stopped or in running state.
     * @returns Array object of ec2 instances
    */
    function (done) {
      let params = {
          Filters: [{
              Name: 'tag:Name',
              Values: [TAG_NAME]
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
          async.map(instances.Reservations, (instance, done1) => {
              done1(null,instance.Instances[0]);
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
                  Name: 'AMI_' + instanceId + '_' + moment.tz(new Date(), "Asia/Kolkata").valueOf().toString(),
                  Description: 'This is an AMI of ' + instanceId + '. Created on : ' + new Date().getTime(),
                  NoReboot: true
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
                      TotalOperationForASG.push(instanceInfo);
                      let imageTags = instance.Tags;
                      imageTags.forEach(element => {
                          if (element.Key.indexOf("aws:", 0) == -1) {
                              Tags.push(element);
                          }
                      });
                      Tags.push({
                          Key: 'ExpireOn',
                          Value: moment.tz(new Date(), "Asia/Kolkata").add(RETENTION_TIME, RETENTION_TYPE).format("dddd, MMMM Do YYYY, h:mm:ss a")
                      },{
                        Key: 'CreatedOn',
                        Value: moment.tz(new Date(), "Asia/Kolkata").format("dddd, MMMM Do YYYY, h:mm:ss a")
                      },{
                        Key: 'InstanceId',
                        Value: instanceId
                      });
                      var tagparams = {
                          Resources: [data.ImageId],
                          Tags: Tags
                      };
                      ec2.createTags(tagparams, function (err, data1) {
                          if (err) {
                              console.log(err, err.stack);
                              //done1(err, null);
                          }
                          else {
                              console.log("Tags added to the created AMIs");
                              console.log(JSON.stringify(data1));
                              //done1(null, data);
                          }
                      });
                      console.log("AMI image Created");
                      //console.log(JSON.stringify(data));
                      done1(null, data);
                  }
              });
          }, (err, result) => {
              if (err) {
                  done(err, null);
              }
              else {
                  console.log("AMI image Result");
                  console.log(JSON.stringify(result));
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
     * @param {Object} amiImage
     * @param {Function} done
     * @description This function will create a new Launch Configuration using newly created AMI image
     * @returns Callback function
     */

    function (amiImage, done) {
      console.log('Creating Launch Configuration...');
      if ( amiImage && amiImage.length > 0 ) {
        const AMI_Image_Id = amiImage[0].ImageId;
        const Launch_Configuration_Name = LC_PREFIX + '_' + AMI_Image_Id + '_' + moment.tz(new Date(), "Asia/Kolkata").valueOf().toString();
        var params = {
          ImageId: AMI_Image_Id,
          InstanceType: INSTANCE_TYPE,
          KeyName: KEY_NAME,
          LaunchConfigurationName: Launch_Configuration_Name,
          SecurityGroups: [
            SECURITY_GROUP
          ]
        };
        autoscaling.createLaunchConfiguration(params, function(err, data) {
          if (err) {
              console.log(err, err.stack);
              done(err, null);
          }
          else {
              console.log("Launch Configuration Created");
              done(null, Launch_Configuration_Name);
          }
        });

      } else {
        done(null, 'AMI image not found!');
      }
    },

    /**
     *
     * @param {Object} newLaunchConfiguration
     * @param {Function} done
     * @description This function will fetch the existing Launch Configuration name from Auto Scaling Group.
     * @returns Callback function
     */

    function (newLaunchConfiguration, done) {
        console.log('Fetch Existing Launch Configuration...');
        console.log('New Launch Configuration :', newLaunchConfiguration);

        if( newLaunchConfiguration ) {

            var params = {
                AutoScalingGroupNames: [
                    ASG_NAME
                ]
            };
            autoscaling.describeAutoScalingGroups(params, function(err, data) {
                if (err) {
                    console.log(err, err.stack); // an error occurred
                    done(err, null);
                }  else  {
                    //console.log(data.AutoScalingGroups[0].LaunchConfigurationName);
                    done(null, data.AutoScalingGroups[0].LaunchConfigurationName, newLaunchConfiguration);
                }
            });

        } else {
            done(null, 'New Launch Configuration not found!');
        }

    },

    /**
     *
     * @param {Object} existingLaunchConfiguration
     * @param {Function} done
     * @description This function will update the Auto Scaling Group with new Launch Configuration and delete the existing Launch Configuration
     * @returns Callback function
     */

    function (existingLaunchConfiguration, newLaunchConfiguration, done) {
        console.log('Updating Auto Scaling Group...');
        console.log('New Launch Configuration :', newLaunchConfiguration);
        console.log('Existing Launch Configuration :', existingLaunchConfiguration);
        
        if ( newLaunchConfiguration ) {
            var params = {
                AutoScalingGroupName: ASG_NAME,
                LaunchConfigurationName: newLaunchConfiguration
            };
            autoscaling.updateAutoScalingGroup(params, function(err, data) {
                if (err) {
                    console.log(err, err.stack); // an error occurred
                    done(err, null);
                }  else  {
                    console.log("Auto Scaling Group Updated");
                    console.log(data);
                    /* delete existing Launch Configuration */
                    var params2 = {
                        LaunchConfigurationName: existingLaunchConfiguration
                    };
                    autoscaling.deleteLaunchConfiguration(params2, function(err, data1) {
                        if (err) {
                             console.log(err, err.stack); // an error occurred
                        }
                        else {
                            console.log("Existing Launch Configuration %s deleted", existingLaunchConfiguration);
                            console.log(data1); // successful response
                            let launchConfigurationInfo = {};
                            launchConfigurationInfo['existingLaunchConfiguration'] = existingLaunchConfiguration;
                            launchConfigurationInfo['newLaunchConfiguration'] = newLaunchConfiguration;
                            TotalOperationForASG.push(launchConfigurationInfo);
                            done(null, data);
                        }
                    });
                }
            });
        } else {
            done(null, 'New Launch Configuration not found, So Auto Scaling Group can not get updated');
        }
    }

  ], function (err, result) {
        if (err) {
            console.log('Err :: ', err);
            sendEmail('[Err] ASG updation automation script report!', SENDER_EMAIL_ID, TO_EMAIL_IDS, CC_EMAIL_IDS, err);
            callback(err, null);
        }
        else {
            // result now equals 'done'
            console.log(JSON.stringify(TotalOperationForASG));
            let FinalDone = {
                "TotalOperationForASG": TotalOperationForASG,
            }
            let message = "Hello, Report of WordPress Auto Sacling Group Automation script!  \n" +
                "Auto Sacling Group updation result ->  " + JSON.stringify(FinalDone) + ", \n \n " +
                "\n \n " +
                "Thanks";
            sendEmail("ASG updation with latest AMI image automation script report!", SENDER_EMAIL_ID, TO_EMAIL_IDS, CC_EMAIL_IDS, message);  
            callback(null, 'Final Done');
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