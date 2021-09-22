import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as rds from "@aws-cdk/aws-rds";
import * as asg from "@aws-cdk/aws-autoscaling";
import { KeyPair } from "cdk-ec2-key-pair";

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

    ec2InstanceSG.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      "allow SSH connections from anywhere"
    );

    const key = new KeyPair(this, "KeyPair", {
      name: "cdk-keypair",
      description: "key pair created by cdk deployment",
    });

    const autoscalingGroup = new asg.AutoScalingGroup(
      this,
      "autoscaling-group",
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
        machineImage: new ec2.AmazonLinuxImage({
          generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
        }),
        keyName: key.keyPairName,
        minCapacity: 1,
      }
    );

    autoscalingGroup.userData.addCommands(
      "snap install microk8s --classic",
      "usermod -a -G microk8s ec2-user",
      "chown -f -R ec2-user ~/.kube",
      "microk8s status --wait-ready",
      "microk8s enable dns storage helm3"
    );

    new cdk.CfnOutput(this, "Key Name", { value: key.keyPairName });

    new cdk.CfnOutput(this, "Download Key Command", {
      value:
        "aws secretsmanager get-secret-value --secret-id ec2-ssh-key/cdk-keypair/private --query SecretString --output text > cdk-key.pem && chmod 400 cdk-key.pem",
    });
  }
}
