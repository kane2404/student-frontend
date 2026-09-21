pipiline{
    agent{label 'student-node'}
    stage{
        stage('build docker image'){
            steps{
                bat 'docker build -t student-frontend:v1 .'
            }
        }
        stage('docker tag'){
            steps{
                bat 'docker tag student-frontend:v1 kane2404/student-frontend:v1'
            }
        }
        stage('docker push'){
            steps{
                bat 'docker push kane2404/student-frontend:v1'
            }
        }
    }

}