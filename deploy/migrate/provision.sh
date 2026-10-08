#!/bin/bash
# 새 AWS 계정에 서버 한 대를 세운다. 계정이 생기자마자 이것만 돌리면 된다.
#
#   AWS_PROFILE=ames-new bash provision.sh
#
# 왜 손이 아니라 코드인가: 지금 서버는 손으로 만든 것이라 무엇이 어떻게 설정됐는지
# 아무 데도 적혀 있지 않다. 또 옮길 일이 생기면 그때도 처음부터 더듬게 된다.
#
# 만드는 것 — 전부 새 계정 안에서만:
#   보안그룹   80·443 만. SSH 는 열지 않는다 (지금 서버는 22 번이 전 세계에 열려 있다)
#   IAM 역할   SSM 접속용 + 백업 버킷 쓰기. SSH 키 없이 들어간다
#   S3         백업 보관 (지금은 비그로우 계정 버킷으로 가고 있다)
#   EC2        t4g.medium · gp3 40GB · Amazon Linux 2023 (ARM)
#   고정 IP    서버를 껐다 켜도 주소가 안 바뀐다
#
# 두 번 돌려도 안전하다. 이미 있는 것은 건너뛴다.
set -euo pipefail

REGION=${REGION:-ap-northeast-2}
NAME=${NAME:-amescotes-erp}
TYPE=${TYPE:-t4g.medium}
DISK=${DISK:-40}
export AWS_DEFAULT_REGION=$REGION

log() { echo "[$(date '+%F %T')] $*"; }
aws_() { aws --region "$REGION" "$@"; }

ACCOUNT=$(aws_ sts get-caller-identity --query Account --output text)
WHO=$(aws_ sts get-caller-identity --query Arn --output text)
log "계정 $ACCOUNT ($WHO)"
case "$ACCOUNT" in
  858695669700) echo "!! 이건 비그로우 계정이다. 새 계정 자격증명으로 돌려라."; exit 1;;
esac

BUCKET="${NAME}-backups-${ACCOUNT}"
ROLE="${NAME}-ec2-role"
PROFILE="${NAME}-ec2-profile"
SG="${NAME}-sg"

# ── 보안그룹 ─────────────────────────────────────────────
VPC=$(aws_ ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
[ "$VPC" != "None" ] || { echo "기본 VPC 가 없다. 콘솔에서 하나 만들거나 VPC 를 지정해라."; exit 1; }

SGID=$(aws_ ec2 describe-security-groups --filters "Name=group-name,Values=$SG" "Name=vpc-id,Values=$VPC" \
        --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo None)
if [ "$SGID" = "None" ]; then
  SGID=$(aws_ ec2 create-security-group --group-name "$SG" --vpc-id "$VPC" \
          --description "ERP web only (80/443). SSH is intentionally closed - use SSM." \
          --query GroupId --output text)
  # 웹 두 개만. 들어가는 건 SSM 으로 한다 — 열어 둔 22 번은 결국 누가 두드린다
  aws_ ec2 authorize-security-group-ingress --group-id "$SGID" \
    --ip-permissions \
      'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0,Description=http}]' \
      'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0,Description=https}]' >/dev/null
  log "보안그룹 $SGID (80·443 만)"
else
  log "보안그룹 $SGID 이미 있음"
fi

# ── S3 백업 버킷 ────────────────────────────────────────
if ! aws_ s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  aws_ s3api create-bucket --bucket "$BUCKET" \
    --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
  aws_ s3api put-public-access-block --bucket "$BUCKET" \
    --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" >/dev/null
  aws_ s3api put-bucket-encryption --bucket "$BUCKET" \
    --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' >/dev/null
  # 덤프에 원가·거래처·급여가 들어 있다. 실수로 지워도 되살릴 수 있게 버전을 남긴다
  aws_ s3api put-bucket-versioning --bucket "$BUCKET" \
    --versioning-configuration Status=Enabled >/dev/null
  # 90일 지난 덤프는 정리한다. 안 그러면 하루 373MB 씩 쌓인다
  aws_ s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{
    "Rules":[{"ID":"expire-old","Status":"Enabled","Filter":{"Prefix":"backups/"},
      "Expiration":{"Days":90},
      "NoncurrentVersionExpiration":{"NoncurrentDays":30}}]}' >/dev/null
  log "버킷 $BUCKET (비공개·암호화·버전·90일)"
else
  log "버킷 $BUCKET 이미 있음"
fi

# ── IAM 역할 ────────────────────────────────────────────
if ! aws_ iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws_ iam create-role --role-name "$ROLE" --assume-role-policy-document '{
    "Version":"2012-10-17","Statement":[{"Effect":"Allow",
      "Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws_ iam attach-role-policy --role-name "$ROLE" \
    --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
  # 백업은 올리기만 하면 된다. 지우기·다른 버킷 읽기는 주지 않는다
  aws_ iam put-role-policy --role-name "$ROLE" --policy-name backup-write \
    --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",
      \"Action\":[\"s3:PutObject\"],\"Resource\":\"arn:aws:s3:::$BUCKET/*\"}]}"
  log "역할 $ROLE"
else
  log "역할 $ROLE 이미 있음"
fi

if ! aws_ iam get-instance-profile --instance-profile-name "$PROFILE" >/dev/null 2>&1; then
  aws_ iam create-instance-profile --instance-profile-name "$PROFILE" >/dev/null
  aws_ iam add-role-to-instance-profile --instance-profile-name "$PROFILE" --role-name "$ROLE"
  log "인스턴스 프로파일 $PROFILE — IAM 반영까지 15초 기다린다"
  sleep 15
fi

# ── EC2 ─────────────────────────────────────────────────
IID=$(aws_ ec2 describe-instances \
       --filters "Name=tag:Name,Values=${NAME}-app" "Name=instance-state-name,Values=pending,running,stopped" \
       --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null || echo None)

if [ "$IID" = "None" ] || [ -z "$IID" ]; then
  # SSM 공개 파라미터는 계정에 따라 안 보인다 (ParameterNotFound). 이미지를 직접 찾는다
  AMI=$(aws_ ec2 describe-images --owners amazon \
         --filters "Name=name,Values=al2023-ami-2023.*-kernel-6.1-arm64" "Name=state,Values=available" \
         --query 'reverse(sort_by(Images,&CreationDate))[0].ImageId' --output text)
  [ -n "$AMI" ] && [ "$AMI" != "None" ] || { echo "AL2023 ARM64 이미지를 못 찾았다"; exit 1; }
  log "AMI $AMI 로 $TYPE 생성"
  IID=$(aws_ ec2 run-instances \
    --image-id "$AMI" --instance-type "$TYPE" --security-group-ids "$SGID" \
    --iam-instance-profile "Name=$PROFILE" \
    --metadata-options "HttpTokens=required,HttpEndpoint=enabled" \
    --block-device-mappings "[{\"DeviceName\":\"/dev/xvda\",\"Ebs\":{\"VolumeSize\":$DISK,\"VolumeType\":\"gp3\",\"Encrypted\":true,\"DeleteOnTermination\":true}}]" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${NAME}-app},{Key=Project,Value=$NAME},{Key=Owner,Value=AMESCOTES}]" \
    --query 'Instances[0].InstanceId' --output text)
  # 키페어를 안 준다. SSH 로 들어갈 길을 아예 만들지 않는다 (SSM 으로 들어간다)
  log "인스턴스 $IID — 뜨는 중"
  aws_ ec2 wait instance-running --instance-ids "$IID"
else
  log "인스턴스 $IID 이미 있음"
fi

# ── 고정 IP ─────────────────────────────────────────────
EIPJSON=$(aws_ ec2 describe-addresses --filters "Name=tag:Name,Values=${NAME}-eip" --query 'Addresses[0].[PublicIp,AllocationId,InstanceId]' --output text 2>/dev/null || echo 'None None None')
read -r EIP EIP_ALLOC EIP_ON <<<"$EIPJSON"
# 고정 IP 는 있는데 다른(또는 없어진) 인스턴스에 붙어 있으면 DNS 와 서버가 따로 논다.
# 주소는 살아 있으니 아무도 에러를 못 본다 — 그냥 안 열릴 뿐이다 (코덱스 지적)
if [ "$EIP" != "None" ] && [ -n "$EIP" ] && [ "$EIP_ON" != "$IID" ]; then
  log "고정 IP $EIP 가 이 인스턴스에 안 붙어 있다 — 다시 붙인다"
  aws_ ec2 associate-address --instance-id "$IID" --allocation-id "$EIP_ALLOC" >/dev/null
fi
if [ "$EIP" = "None" ] || [ -z "$EIP" ]; then
  ALLOC=$(aws_ ec2 allocate-address --domain vpc \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=${NAME}-eip}]" \
    --query AllocationId --output text)
  aws_ ec2 associate-address --instance-id "$IID" --allocation-id "$ALLOC" >/dev/null
  EIP=$(aws_ ec2 describe-addresses --allocation-ids "$ALLOC" --query 'Addresses[0].PublicIp' --output text)
  log "고정 IP $EIP 붙임"
fi

log "SSM 으로 붙을 때까지 기다린다 (1~2분)"
for i in $(seq 1 40); do
  ST=$(aws_ ssm describe-instance-information \
        --filters "Key=InstanceIds,Values=$IID" --query 'InstanceInformationList[0].PingStatus' \
        --output text 2>/dev/null || echo None)
  [ "$ST" = "Online" ] && break
  sleep 10
done

cat <<EOF

────────────────────────────────────────────
 인스턴스   $IID
 고정 IP    $EIP
 백업 버킷  s3://$BUCKET
 SSM 상태   ${ST:-확인필요}

 다음:
  1. DNS A 레코드 5개를 $EIP 로
       erp · ceo · daily · hr · os  →  $EIP
  2. 서버 세팅
       aws ssm start-session --target $IID
       sudo su - ; curl -sL <bootstrap.sh> -o bootstrap.sh ; bash bootstrap.sh ameserp.kr
  3. 데이터는 나중에 cutover.sh 로 (일 안 할 때)
────────────────────────────────────────────
EOF
