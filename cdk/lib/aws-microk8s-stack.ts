import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as rds from "@aws-cdk/aws-rds";
import * as asg from "@aws-cdk/aws-autoscaling";
import * as iam from "@aws-cdk/aws-iam";
import { readFileSync } from "fs";

export class AwsMicrok8SStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "my-vpc", {
      cidr: "10.0.0.0/16",
      natGateways: 0,
      maxAzs: 3,
      subnetConfiguration: [
        {
          name: "public-subnet-1",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: "private-subnet-1",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 28,
        },
      ],
    });

    const ec2InstanceSG = new ec2.SecurityGroup(this, "ec2-instance-sg", {
      vpc,
    });

    ec2InstanceSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22));
    ec2InstanceSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443));
    ec2InstanceSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80));

    const elasticIp = new ec2.CfnEIP(this, "cdk-eip");

    const ec2Role = new iam.Role(this, "ec2-role", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
    });

    ec2Role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ec2:AssociateAddress", "ec2:DisassociateAddress"],
        resources: ["*"],
      })
    );

    const userData = ec2.UserData.custom(
      cdk.Fn.sub(readFileSync("userData/associate-elastic-ip.sh", "utf-8"), {
        ELASTIC_IP_ALLOCATION_ID: elasticIp.attrAllocationId,
      })
    );

    userData.addCommands(
      "apt update",
      "apt install snapd",
      "snap install microk8s --classic",
      "usermod -a -G microk8s ubuntu",
      "chown -f -R ubuntu ~/.kube",
      "newgrp microk8s",
      "su - ubuntu",
      "microk8s status --wait-ready",
      `microk8s enable dns storage helm3 metallb:${elasticIp.ref}`
    );

    const autoscalingGroup = new asg.AutoScalingGroup(
      this,
      "ec2-instance-asg",
      {
        vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PUBLIC,
        },
        securityGroup: ec2InstanceSG,
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.T3,
          ec2.InstanceSize.MICRO
        ),
        machineImage: ec2.MachineImage.fromSsmParameter(
          "/aws/service/canonical/ubuntu/server/focal/stable/current/amd64/hvm/ebs-gp2/ami-id",
          { os: ec2.OperatingSystemType.LINUX }
        ),
        blockDevices: [
          {
            deviceName: "/dev/sda1",
            volume: asg.BlockDeviceVolume.ebs(20),
          },
        ],
        userData,
        updatePolicy: asg.UpdatePolicy.rollingUpdate(),
        role: ec2Role,
      }
    );

    // This doesn't have termination protection so be careful
    // const rdsInstance = new rds.DatabaseInstance(this, "Cdk-rds-instance", {
    //   engine: rds.DatabaseInstanceEngine.postgres({
    //     version: rds.PostgresEngineVersion.VER_12_7,
    //   }),
    //   instanceType: ec2.InstanceType.of(
    //     ec2.InstanceClass.T2,
    //     ec2.InstanceSize.MICRO
    //   ),
    //   vpc,
    //   vpcSubnets: {
    //     subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
    //   },
    // });

    new cdk.CfnOutput(this, "Download Key Command", {
      value:
        "aws secretsmanager get-secret-value --secret-id ec2-ssh-key/cdk-keypair/private --query SecretString --output text > cdk-key.pem && chmod 400 cdk-key.pem",
    });
  }
}
